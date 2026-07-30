import { useCallback, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonButton,
  IonBackButton, IonList, IonItem, IonLabel, IonText, IonSpinner, IonModal,
  IonInput, IonNote, IonGrid, IonRow, IonCol, IonIcon, IonLoading,
  IonSelect, IonSelectOption, useIonViewWillEnter,
  useIonAlert, useIonActionSheet,
} from '@ionic/react';
import { documentTextOutline, createOutline } from 'ionicons/icons';
import { getCustomer, updateCustomer, type Customer } from '../data/customers';
import {
  listTransactions, getBalances, addTransaction, type Transaction, type TxnType,
} from '../data/transactions';
import { toMinor } from '../data/money';
import { getSettings, messageSender } from '../data/settings';
import { getRates } from '../data/rates';
import {
  BASE_CURRENCY, CURRENCIES, currencyDef, describeAmount, describeConversion,
  formatAmount, DEFAULT_RATES, type CurrencyBalance, type CurrencyCode, type Rates,
} from '../data/currencies';
import {
  ROLES, directionColor, directionLabel, orderedTypes, roleDef, type ContactRole,
} from '../data/roles';
import { isAccountActive, INACTIVE_MESSAGE } from '../data/account';
import { buildMessage, sendSms, openWhatsApp } from '../lib/notify';
import { FEATURES } from '../config';
import BalanceSummary from '../components/BalanceSummary';

// Contact detail — transaction history + record an entry in either direction.
// Append-only (CLAUDE.md): a transaction is never edited or deleted; a
// correction is a reversing entry.
//
// Every entry carries its own CURRENCY, and the currency is part of the debt —
// so the amount field and the history rows both name it explicitly rather than
// assuming riyals.
const CustomerDetail: React.FC = () => {
  const { id: customerId } = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [balances, setBalances] = useState<CurrencyBalance[]>([]);
  const [rates, setRates] = useState<Rates>(DEFAULT_RATES);
  const [loading, setLoading] = useState(true);

  // add-transaction modal state. `formType` decides debt vs payment.
  const modal = useRef<HTMLIonModalElement>(null);
  const [formType, setFormType] = useState<TxnType>('debt');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(BASE_CURRENCY);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // edit-contact modal state. The role in particular has to be changeable after
  // the fact: everything the contact reads — «تسجيل دين» vs «أخذت منك» — hangs
  // off it, and contacts created before roles existed are all «زبون».
  const editModal = useRef<HTMLIonModalElement>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editRole, setEditRole] = useState<ContactRole>('customer');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  // A long history takes a few seconds to render into the PDF; without this the
  // screen just sits there and reads as a freeze.
  const [exporting, setExporting] = useState(false);
  // Synchronous in-flight guard — `saving` state updates a tick late, so a fast
  // double-tap could slip a second (duplicate) transaction through before the
  // button re-renders disabled. The ref blocks the second call immediately.
  const savingRef = useRef(false);
  const [presentAlert] = useIonAlert();
  const [presentSheet] = useIonActionSheet();

  const load = useCallback(async () => {
    const [c, list, bals, currentRates] = await Promise.all([
      getCustomer(customerId),
      listTransactions(customerId),
      getBalances(customerId),
      getRates(),
    ]);
    setCustomer(c);
    setTxns(list);
    setBalances(bals);
    setRates(currentRates);
    setLoading(false);
  }, [customerId]);

  useIonViewWillEnter(() => { void load(); });

  const openForm = async (type: TxnType) => {
    if (!(await isAccountActive())) {
      presentAlert({
        header: 'حساب غير مفعّل',
        message: INACTIVE_MESSAGE,
        buttons: ['حسناً'],
      });
      return;
    }
    setFormType(type);
    setAmount('');
    setCurrency(BASE_CURRENCY);
    setNote('');
    setError(null);
    void modal.current?.present();
  };

  const save = async () => {
    setError(null);
    const major = Number(amount.replace(',', '.'));
    if (!amount.trim() || Number.isNaN(major) || major <= 0) {
      setError('أدخل مبلغاً صحيحاً أكبر من صفر');
      return;
    }
    if (savingRef.current) return; // a save is already in flight — ignore the re-tap
    savingRef.current = true;
    setSaving(true);
    try {
      const amountMinor = toMinor(major);
      const entryCurrency = currency;
      await addTransaction({
        customerId,
        type: formType,
        amount: amountMinor,
        currency: entryCurrency,
        note: note.trim() || null,
      });
      await load();
      await modal.current?.dismiss();
      await notifyCustomer(formType, amountMinor, entryCurrency, note.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  // After recording a debt/payment, tell the customer (from the shopkeeper's own
  // phone). Auto-sends SMS — the main notice (amount + balance) and, if present,
  // the grocer's note as its own separate SMS (Android only; no-op on web). Then
  // offers the same messages via WhatsApp. Failures never block the save.
  const notifyCustomer = async (
    type: TxnType, amountMinor: number, entryCurrency: CurrencyCode, noteText: string,
  ) => {
    const c = await getCustomer(customerId);
    if (!c) return;
    const [settings, newBalances, currentRates] = await Promise.all([
      getSettings(),
      getBalances(customerId),
      getRates(),
    ]);
    if (!settings.notifyCustomers) return; // notifications turned off in Settings
    const message = buildMessage({
      senderName: messageSender(settings),
      role: c.role, // the wording of the whole message follows the contact's role
      type,
      amount: amountMinor,
      currency: entryCurrency,
      balances: newBalances,
      rates: currentRates,
      note: noteText, // folded into the one message on its own line
    });
    void sendSms(c.phone, message); // auto: one combined SMS (balance + note)
    presentSendSheet(c.phone, message);
  };

  // WhatsApp send sheet — one olive "send" button + "cancel". The chosen action
  // runs from onDidDismiss (after the sheet has fully closed) so the cancel
  // confirmation can present without racing the dismiss animation.
  const presentSendSheet = (phone: string, message: string) => {
    let choice: 'send' | 'cancel' | null = null;
    presentSheet({
      header: 'إرسال إشعار عبر واتساب',
      buttons: [
        { text: 'إرسال عبر واتساب', cssClass: 'as-olive', handler: () => { choice = 'send'; } },
        { text: 'إلغاء', cssClass: 'as-olive', handler: () => { choice = 'cancel'; } },
      ],
      onDidDismiss: () => {
        // Anything other than an explicit "send" — the إلغاء button, the back
        // button, or a backdrop tap — is treated as a cancel and confirmed.
        if (choice === 'send') openWhatsApp(phone, message);
        else confirmCancel(phone, message);
      },
    });
  };

  // Make sure cancelling the WhatsApp notice was intentional. "تراجع" reopens the
  // send sheet (deferred so this alert has finished dismissing first).
  const confirmCancel = (phone: string, message: string) => {
    presentAlert({
      header: 'تأكيد الإلغاء',
      message: 'هل أنت متأكد أنك لا تريد إرسال الإشعار عبر واتساب؟',
      buttons: [
        {
          text: 'تراجع',
          cssClass: 'alert-btn-send',
          handler: () => setTimeout(() => presentSendSheet(phone, message), 350),
        },
        { text: 'نعم، إلغاء', role: 'cancel', cssClass: 'alert-btn-cancel' },
      ],
    });
  };

  // ---- Edit the contact ----
  //
  // Name, phone, note and role. Changing the role rewrites what both the screen
  // and every future message call the two directions, so the whole page is
  // reloaded afterwards rather than patched in place.
  const openEdit = () => {
    if (!customer) return;
    setEditName(customer.name);
    setEditPhone(customer.phone);
    setEditNote(customer.note ?? '');
    setEditRole(customer.role);
    setEditError(null);
    void editModal.current?.present();
  };

  const saveEdit = async () => {
    setEditError(null);
    if (!editName.trim()) { setEditError('الاسم مطلوب'); return; }
    if (!editPhone.trim()) { setEditError('رقم الهاتف مطلوب'); return; }
    setEditSaving(true);
    try {
      await updateCustomer(customerId, {
        name: editName,
        phone: editPhone,
        note: editNote.trim() || null,
        role: editRole,
      });
      await load();
      await editModal.current?.dismiss();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setEditSaving(false);
    }
  };

  // Export a PDF statement for this customer. Ask which period first, filter
  // the history by occurred_at, then render + share (see lib/pdf.ts).
  const askExport = () => {
    presentSheet({
      header: 'تصدير كشف حساب PDF',
      buttons: [
        { text: 'اليوم', handler: () => { void doExport('day'); } },
        { text: 'هذا الشهر', handler: () => { void doExport('month'); } },
        { text: 'كل الحركات', handler: () => { void doExport('full'); } },
        { text: 'إلغاء', role: 'cancel' },
      ],
    });
  };

  const doExport = async (period: 'day' | 'month' | 'full') => {
    if (!customer) return;
    const now = new Date();
    const inPeriod = (iso: string) => {
      if (period === 'full') return true;
      const d = new Date(iso);
      if (period === 'day') return d.toDateString() === now.toDateString();
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    };
    const filtered = txns.filter((t) => inPeriod(t.occurred_at));
    const settings = await getSettings();
    const periodLabel = period === 'day' ? 'اليوم' : period === 'month' ? 'هذا الشهر' : 'كل الحركات';
    setExporting(true);
    try {
      // Loaded on demand — jspdf + html2canvas together are most of the bundle,
      // and a session that never exports shouldn't pay to parse them.
      const { exportCustomerStatement } = await import('../lib/pdf');
      await exportCustomerStatement({
        customer,
        transactions: filtered,
        storeName: messageSender(settings),
        rates,
        periodLabel,
      });
    } catch {
      presentAlert({ header: 'خطأ', message: 'تعذّر إنشاء ملف PDF', buttons: ['حسناً'] });
    } finally {
      setExporting(false);
    }
  };

  // Button/label wording follows the contact's role: recording «دين» against a
  // shop you buy from reads backwards, so each role names its two directions.
  // The order and the colours follow it too — for a صاحب متجر the debt-growing
  // entry is the 'payment' one, and it still has to be the red button on the
  // right, or a new debt shows up green.
  const role = customer?.role ?? 'customer';
  const [firstType, secondType] = orderedTypes(role);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/home" text="رجوع" />
          </IonButtons>
          <IonTitle>{customer?.name ?? 'جهة'}</IonTitle>
          <IonButtons slot="end">
            {/* Owner build only — see FEATURES.editContacts in config.ts. */}
            {FEATURES.editContacts && (
              <IonButton onClick={openEdit} disabled={!customer}>
                <IonIcon slot="icon-only" icon={createOutline} />
              </IonButton>
            )}
            <IonButton onClick={askExport} disabled={!customer}>
              <IonIcon slot="icon-only" icon={documentTextOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent>
        {loading ? (
          <div className="ion-text-center ion-padding">
            <IonSpinner name="crescent" />
          </div>
        ) : !customer ? (
          <IonText color="medium">
            <p className="ion-text-center ion-padding">الجهة غير موجودة.</p>
          </IonText>
        ) : (
          <>
            {/* Balance summary — one line per currency in play, plus a YER
                equivalent at today's rates when there is more than one. */}
            <div className="balance-card">
              <div className="balance-card__label">
                الرصيد الحالي · {roleDef(role).labelAr}
              </div>
              <BalanceSummary balances={balances} rates={rates} align="center" />
            </div>

            {/* The two directions, everyday one first, named for this role */}
            <IonGrid>
              <IonRow>
                {[firstType, secondType].map((t) => (
                  <IonCol key={t}>
                    <IonButton
                      expand="block"
                      color={directionColor(role, t)}
                      onClick={() => openForm(t)}
                    >
                      {directionLabel(role, t)}
                    </IonButton>
                  </IonCol>
                ))}
              </IonRow>
            </IonGrid>

            {/* History — newest first */}
            {txns.length === 0 ? (
              <IonText color="medium">
                <p className="ion-text-center ion-padding">لا توجد حركات بعد.</p>
              </IonText>
            ) : (
              <IonList>
                {txns.map((t) => (
                  <IonItem key={t.id}>
                    <IonLabel>
                      <h2 style={{ color: `var(--ion-color-${directionColor(role, t.type)})` }}>
                        {directionLabel(role, t.type)}
                      </h2>
                      {t.note && <p>{t.note}</p>}
                      <p>{new Date(t.occurred_at).toLocaleString('ar')}</p>
                    </IonLabel>
                    <IonText slot="end" color={directionColor(role, t.type)}>
                      <div style={{ textAlign: 'end' }}>
                        <strong>{formatAmount(t.amount, t.currency)}</strong>
                        {/* Foreign-currency and gold entries also show what they
                            are worth today — the native figure stays the record. */}
                        {describeConversion(t.amount, t.currency, rates) && (
                          <div style={{ fontSize: '0.7em', opacity: 0.8 }}>
                            {describeConversion(t.amount, t.currency, rates)}
                          </div>
                        )}
                      </div>
                    </IonText>
                  </IonItem>
                ))}
              </IonList>
            )}
          </>
        )}

        <IonModal ref={modal}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>{directionLabel(role, formType)}</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => modal.current?.dismiss()}>إلغاء</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonItem>
              <IonLabel position="stacked">العملة</IonLabel>
              <IonSelect
                value={currency}
                onIonChange={(e) => setCurrency(e.detail.value as CurrencyCode)}
                interface="popover"
              >
                {CURRENCIES.map((c) => (
                  <IonSelectOption key={c.code} value={c.code}>{c.longAr}</IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">
                {currencyDef(currency).isWeight ? 'الوزن بالجرام' : `المبلغ (${currencyDef(currency).shortAr})`}
              </IonLabel>
              <IonInput
                type="number"
                inputmode="decimal"
                value={amount}
                onIonInput={(e) => setAmount(e.detail.value ?? '')}
                placeholder="0"
              />
            </IonItem>
            {/* Live conversion while typing, so the owner sees what the entry is
                worth in riyals before committing to it. */}
            {currency !== BASE_CURRENCY && Number(amount.replace(',', '.')) > 0 && (
              <IonNote className="ion-padding-start">
                <IonText color="medium">
                  {describeAmount(toMinor(Number(amount.replace(',', '.'))), currency, rates)}
                </IonText>
              </IonNote>
            )}
            <IonItem>
              <IonLabel position="stacked">ملاحظة (اختياري)</IonLabel>
              <IonInput
                value={note}
                onIonInput={(e) => setNote(e.detail.value ?? '')}
              />
            </IonItem>

            {error && (
              <IonNote color="danger" className="ion-padding-start">
                <IonText>{error}</IonText>
              </IonNote>
            )}

            <IonButton
              expand="block"
              color={directionColor(role, formType)}
              onClick={save}
              disabled={saving}
              className="ion-margin-top"
            >
              {saving ? <IonSpinner name="crescent" /> : 'حفظ'}
            </IonButton>
          </IonContent>
        </IonModal>

        {/* Edit the contact — including its role, which decides the wording of
            every message this contact receives from here on. Not mounted at all
            outside the owner build, so there is no way to reach it. */}
        {FEATURES.editContacts && (
        <IonModal ref={editModal}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>تعديل الجهة</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => editModal.current?.dismiss()}>إلغاء</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonItem>
              <IonLabel position="stacked">الاسم</IonLabel>
              <IonInput
                value={editName}
                onIonInput={(e) => setEditName(e.detail.value ?? '')}
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">رقم الهاتف</IonLabel>
              <IonInput
                type="tel"
                inputmode="tel"
                value={editPhone}
                onIonInput={(e) => setEditPhone(e.detail.value ?? '')}
              />
            </IonItem>
            <IonItem>
              <IonLabel>الصفة</IonLabel>
              <IonSelect
                value={editRole}
                onIonChange={(e) => setEditRole(e.detail.value as ContactRole)}
                interface="popover"
              >
                {ROLES.map((r) => (
                  <IonSelectOption key={r.role} value={r.role}>{r.labelAr}</IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">ملاحظة (اختياري)</IonLabel>
              <IonInput
                value={editNote}
                onIonInput={(e) => setEditNote(e.detail.value ?? '')}
              />
            </IonItem>

            <IonNote color="medium" className="ion-padding-start">
              <IonText>
                تغيير الصفة يغيّر تسمية الحركات ونص الرسائل المرسلة لهذه الجهة،
                ولا يغيّر الأرصدة ولا الحركات المسجّلة.
              </IonText>
            </IonNote>

            {editError && (
              <IonNote color="danger" className="ion-padding-start">
                <IonText>{editError}</IonText>
              </IonNote>
            )}

            <IonButton
              expand="block"
              onClick={saveEdit}
              disabled={editSaving}
              className="ion-margin-top"
            >
              {editSaving ? <IonSpinner name="crescent" /> : 'حفظ'}
            </IonButton>
          </IonContent>
        </IonModal>
        )}

        <IonLoading isOpen={exporting} message="جارٍ إنشاء الكشف..." />
      </IonContent>
    </IonPage>
  );
};

export default CustomerDetail;
