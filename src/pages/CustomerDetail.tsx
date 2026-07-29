import { useCallback, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonButton,
  IonBackButton, IonList, IonItem, IonLabel, IonText, IonSpinner, IonModal,
  IonInput, IonNote, IonGrid, IonRow, IonCol, IonIcon, IonLoading, useIonViewWillEnter,
  useIonAlert, useIonActionSheet,
} from '@ionic/react';
import { documentTextOutline } from 'ionicons/icons';
import { getCustomer, type Customer } from '../data/customers';
import {
  listTransactions, getBalance, addTransaction, type Transaction, type TxnType,
} from '../data/transactions';
import { formatMinor, toMinor } from '../data/money';
import { getSettings } from '../data/settings';
import { isAccountActive, INACTIVE_MESSAGE } from '../data/account';
import { buildMessage, sendSms, openWhatsApp } from '../lib/notify';
import { exportCustomerStatement } from '../lib/pdf';

const CURRENCY = 'YER';

// Customer detail — transaction history + add debt/payment. Append-only
// (CLAUDE.md): a transaction is never edited or deleted; a correction is a
// reversing entry (record a payment to cancel a debt, or vice-versa).
const CustomerDetail: React.FC = () => {
  const { id: customerId } = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  // add-transaction modal state. `formType` decides debt vs payment.
  const modal = useRef<HTMLIonModalElement>(null);
  const [formType, setFormType] = useState<TxnType>('debt');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
    const [c, list, bal] = await Promise.all([
      getCustomer(customerId),
      listTransactions(customerId),
      getBalance(customerId),
    ]);
    setCustomer(c);
    setTxns(list);
    setBalance(bal);
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
      await addTransaction({
        customerId,
        type: formType,
        amount: amountMinor,
        note: note.trim() || null,
      });
      await load();
      await modal.current?.dismiss();
      await notifyCustomer(formType, amountMinor, note.trim());
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
  const notifyCustomer = async (type: TxnType, amountMinor: number, noteText: string) => {
    const c = await getCustomer(customerId);
    if (!c) return;
    const [settings, newBalance] = await Promise.all([
      getSettings(),
      getBalance(customerId),
    ]);
    if (!settings.notifyCustomers) return; // notifications turned off in Settings
    const message = buildMessage({
      storeName: settings.storeName,
      type,
      amount: amountMinor,
      balance: newBalance,
      currency: settings.currency,
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
      await exportCustomerStatement({
        customer,
        transactions: filtered,
        storeName: settings.storeName,
        currency: settings.currency,
        periodLabel,
      });
    } catch {
      presentAlert({ header: 'خطأ', message: 'تعذّر إنشاء ملف PDF', buttons: ['حسناً'] });
    } finally {
      setExporting(false);
    }
  };

  const balanceColor = balance > 0 ? 'danger' : balance < 0 ? 'success' : 'medium';
  const balanceLabel = balance > 0 ? 'عليه' : balance < 0 ? 'له' : 'مسدد';

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/home" text="رجوع" />
          </IonButtons>
          <IonTitle>{customer?.name ?? 'العميل'}</IonTitle>
          <IonButtons slot="end">
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
            <p className="ion-text-center ion-padding">العميل غير موجود.</p>
          </IonText>
        ) : (
          <>
            {/* Balance summary */}
            <div className="balance-card">
              <div className="balance-card__label">الرصيد الحالي</div>
              <IonText color={balanceColor}>
                <div className="balance-card__amount">
                  <strong>{formatMinor(Math.abs(balance))} {CURRENCY}</strong>
                </div>
                <div className="balance-card__dir">{balanceLabel}</div>
              </IonText>
            </div>

            {/* Add debt / add payment */}
            <IonGrid>
              <IonRow>
                <IonCol>
                  <IonButton expand="block" color="danger" onClick={() => openForm('debt')}>
                    إضافة دين
                  </IonButton>
                </IonCol>
                <IonCol>
                  <IonButton expand="block" color="success" onClick={() => openForm('payment')}>
                    إضافة دفعة
                  </IonButton>
                </IonCol>
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
                      <h2 style={{ color: t.type === 'debt' ? 'var(--ion-color-danger)' : 'var(--ion-color-success)' }}>
                        {t.type === 'debt' ? 'دين' : 'دفعة'}
                      </h2>
                      {t.note && <p>{t.note}</p>}
                      <p>{new Date(t.occurred_at).toLocaleString('ar')}</p>
                    </IonLabel>
                    <IonText slot="end" color={t.type === 'debt' ? 'danger' : 'success'}>
                      <strong>{formatMinor(t.amount)} {CURRENCY}</strong>
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
              <IonTitle>{formType === 'debt' ? 'إضافة دين' : 'إضافة دفعة'}</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => modal.current?.dismiss()}>إلغاء</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonItem>
              <IonLabel position="stacked">المبلغ ({CURRENCY})</IonLabel>
              <IonInput
                type="number"
                inputmode="decimal"
                value={amount}
                onIonInput={(e) => setAmount(e.detail.value ?? '')}
                placeholder="0"
              />
            </IonItem>
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
              color={formType === 'debt' ? 'danger' : 'success'}
              onClick={save}
              disabled={saving}
              className="ion-margin-top"
            >
              {saving ? <IonSpinner name="crescent" /> : 'حفظ'}
            </IonButton>
          </IonContent>
        </IonModal>

        <IonLoading isOpen={exporting} message="جارٍ إنشاء الكشف..." />
      </IonContent>
    </IonPage>
  );
};

export default CustomerDetail;
