import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  IonContent, IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonButton,
  IonIcon, IonRefresher, IonRefresherContent, IonSpinner, IonModal, IonList, IonItem, IonInput,
  IonSelect, IonSelectOption, useIonViewWillEnter, useIonAlert, useIonToast, useIonRouter,
} from '@ionic/react';
import { createOutline, trashOutline } from 'ionicons/icons';
import {
  ApiError, Contact as ContactRow, Entry, Role,
  getContact, updateContact, deleteContact, deleteEntry, reverseEntry,
} from '../lib/api';
import { ROLE_AR, balanceText, dateTime, money } from '../lib/format';
import { digitsOnly } from '../lib/digits';

// One contact in one account's book: its entries (with ids), and the owner's
// three corrections — edit / delete the contact, and per entry either DELETE
// it outright (only an updated shop app drops it) or REVERSE it with an
// opposite entry (every version of the app receives that).

const Contact: React.FC = () => {
  const { id, cid } = useParams<{ id: string; cid: string }>();
  const router = useIonRouter();
  const [contact, setContact] = useState<ContactRow | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', note: '', role: 'customer' as Role });
  const [presentAlert] = useIonAlert();
  const [presentToast] = useIonToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await getContact(id, cid);
      setContact(res.customer);
      setEntries(res.transactions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    }
  }, [id, cid]);

  useIonViewWillEnter(() => { void load(); }, [load]);

  const toast = (message: string, ok = true) =>
    presentToast({ message, duration: ok ? 1800 : 2800, color: ok ? 'success' : 'danger' });

  const run = async (action: () => Promise<unknown>, done: string, after?: () => void) => {
    setBusy(true);
    try {
      await action();
      toast(done);
      if (after) after(); else await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'تعذّر التنفيذ', false);
    } finally {
      setBusy(false);
    }
  };

  const confirm = (header: string, message: string, text: string, onYes: () => void) =>
    presentAlert({
      header,
      message,
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        { text, role: 'destructive', handler: onYes },
      ],
    });

  const entryLine = (t: Entry) =>
    `${t.type === 'debt' ? '+ دين' : '− تسديد'} ${money(t.amount, t.currency)} — ${dateTime(t.occurred_at)}`;

  const askDelete = (t: Entry) =>
    confirm(
      'حذف الحركة',
      `${entryLine(t)}\n\nتُحذف نهائياً وتختفي من الرصيد. تختفي من هاتف صاحب الحساب فقط إذا كان تطبيقه محدّثاً — وإلا فاستخدم «عكس».`,
      'حذف',
      () => void run(() => deleteEntry(id, t.id), 'تم حذف الحركة'),
    );

  const askReverse = (t: Entry) =>
    confirm(
      'عكس الحركة',
      `${entryLine(t)}\n\nتُضاف حركة معاكسة بنفس المبلغ فيعود الرصيد كما كان. تبقى الحركتان في السجل، وتصل لكل نسخ التطبيق.`,
      'عكس',
      () => void run(() => reverseEntry(id, t.id), 'تمت إضافة الحركة المعاكسة'),
    );

  const askDeleteContact = () => {
    if (!contact) return;
    confirm(
      'حذف الجهة',
      `حذف «${contact.name}» من دفتر هذا الحساب؟ يختفي من هاتفه في المزامنة القادمة.`,
      'حذف',
      () => void run(() => deleteContact(id, cid), 'تم حذف الجهة', () => router.goBack()),
    );
  };

  const openEdit = () => {
    if (!contact) return;
    setForm({ name: contact.name, phone: contact.phone, note: contact.note ?? '', role: contact.role });
    setEditing(true);
  };

  const saveEdit = () => {
    const name = form.name.trim();
    const phone = digitsOnly(form.phone);
    if (!name || !phone) {
      toast('الاسم والرقم مطلوبان', false);
      return;
    }
    void run(
      () => updateContact(id, cid, { ...form, name, phone }),
      'تم الحفظ',
      () => { setEditing(false); void load(); },
    );
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref={`/accounts/${id}`} text="" /></IonButtons>
          <IonTitle>{contact?.name ?? 'الجهة'}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={openEdit} disabled={!contact || busy} aria-label="تعديل">
              <IonIcon slot="icon-only" icon={createOutline} />
            </IonButton>
            <IonButton onClick={askDeleteContact} disabled={!contact || busy} aria-label="حذف الجهة">
              <IonIcon slot="icon-only" icon={trashOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={async (e) => { await load(); e.detail.complete(); }}>
          <IonRefresherContent />
        </IonRefresher>

        {error && <div className="empty">{error}</div>}
        {!contact && !error && <div className="empty"><IonSpinner name="crescent" /></div>}

        {contact && (
          <div className="acct">
            <div className="acct__top">
              <div>
                <div className="acct__name">{contact.name}</div>
                <div className="acct__phone">{contact.phone}</div>
              </div>
              <span className="badge badge--role">{ROLE_AR[contact.role] ?? contact.role}</span>
            </div>
            <div className="acct__meta">
              الرصيد: {contact.balances.length === 0 ? 'مسدد' : contact.balances.map(balanceText).join(' · ')}
              {contact.note && <><br />ملاحظة: {contact.note}</>}
            </div>
          </div>
        )}

        {entries && entries.length === 0 && <div className="empty">لا توجد حركات</div>}

        {entries?.map((t) => (
          <div key={t.id} className="entry">
            <div className="entry__top">
              <span className={t.type === 'debt' ? 'entry__amt entry__amt--debt' : 'entry__amt entry__amt--pay'}>
                {t.type === 'debt' ? '+ دين' : '− تسديد'} {money(t.amount, t.currency)}
              </span>
              <span className="ltr entry__date">{dateTime(t.occurred_at)}</span>
            </div>
            {t.note && <div className="entry__note">{t.note}</div>}
            <div className="entry__id ltr">{t.id}</div>
            <div className="acct__actions">
              <IonButton size="small" fill="outline" disabled={busy} onClick={() => askReverse(t)}>
                عكس
              </IonButton>
              <IonButton size="small" fill="outline" color="danger" disabled={busy} onClick={() => askDelete(t)}>
                حذف
              </IonButton>
            </div>
          </div>
        ))}

        <IonModal isOpen={editing} onDidDismiss={() => setEditing(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>تعديل الجهة</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setEditing(false)}>إلغاء</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonList>
              <IonItem>
                <IonInput label="الاسم" labelPlacement="stacked" value={form.name}
                  onIonInput={(e) => setForm((f) => ({ ...f, name: e.detail.value ?? '' }))} />
              </IonItem>
              <IonItem>
                <IonInput label="الرقم" labelPlacement="stacked" inputmode="tel" value={form.phone}
                  onIonInput={(e) => setForm((f) => ({ ...f, phone: e.detail.value ?? '' }))} />
              </IonItem>
              <IonItem>
                <IonInput label="ملاحظة" labelPlacement="stacked" value={form.note}
                  onIonInput={(e) => setForm((f) => ({ ...f, note: e.detail.value ?? '' }))} />
              </IonItem>
              <IonItem>
                <IonSelect label="النوع" labelPlacement="stacked" value={form.role} interface="action-sheet"
                  onIonChange={(e) => setForm((f) => ({ ...f, role: e.detail.value as Role }))}>
                  {(Object.keys(ROLE_AR) as Role[]).map((r) => (
                    <IonSelectOption key={r} value={r}>{ROLE_AR[r]}</IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>
            </IonList>
            <p className="hint">
              تغيير النوع يغيّر تسمية كل الحركات السابقة في تطبيق صاحب الحساب.
            </p>
            <IonButton expand="block" disabled={busy} onClick={saveEdit}>حفظ</IonButton>
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default Contact;
