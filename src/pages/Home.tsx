import { useCallback, useRef, useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonButton,
  IonList, IonItem, IonLabel, IonText, IonSpinner, IonFab, IonFabButton, IonIcon,
  IonModal, IonInput, IonNote, IonSearchbar, useIonViewWillEnter,
} from '@ionic/react';
import { add } from 'ionicons/icons';
import { useAuth } from '../lib/auth';
import { listCustomers, createCustomer, type Customer } from '../data/customers';
import { getBalance } from '../data/transactions';
import { formatMinor } from '../data/money';

const CURRENCY = 'YER';

// A customer plus its locally-computed running balance (minor units).
interface Row {
  customer: Customer;
  balance: number;
}

// Customer list — the shopkeeper's home. Reads customers + running balances from
// the local data layer (offline-first) and offers an "add customer" flow. The
// transaction history / add debt+payment screen is the next Phase 6 slice.
const Home: React.FC = () => {
  const { user, logout } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // add-customer modal state
  const modal = useRef<HTMLIonModalElement>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const customers = await listCustomers();
    const withBalances = await Promise.all(
      customers.map(async (c) => ({ customer: c, balance: await getBalance(c.id) }))
    );
    setRows(withBalances);
    setLoading(false);
  }, []);

  // Reload every time the page becomes active (e.g. returning from a detail
  // screen after recording a transaction) so balances stay fresh.
  useIonViewWillEnter(() => { void load(); });

  const resetForm = () => {
    setName(''); setPhone(''); setNote(''); setError(null);
  };

  const save = async () => {
    setError(null);
    if (!name.trim()) { setError('الاسم مطلوب'); return; }
    if (!phone.trim()) { setError('رقم الهاتف مطلوب'); return; }
    setSaving(true);
    try {
      await createCustomer({ name, phone, note: note.trim() || null });
      await load();
      resetForm();
      await modal.current?.dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  };

  const term = search.trim().toLowerCase();
  const visible = term
    ? rows.filter((r) =>
        r.customer.name.toLowerCase().includes(term) ||
        r.customer.phone.includes(term))
    : rows;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{user?.store_name || 'دفتر البقالة'}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={logout}>خروج</IonButton>
          </IonButtons>
        </IonToolbar>
        <IonToolbar>
          <IonSearchbar
            value={search}
            onIonInput={(e) => setSearch(e.detail.value ?? '')}
            placeholder="بحث بالاسم أو الهاتف"
          />
        </IonToolbar>
      </IonHeader>

      <IonContent>
        {loading ? (
          <div className="ion-text-center ion-padding">
            <IonSpinner name="crescent" />
          </div>
        ) : rows.length === 0 ? (
          <IonText color="medium">
            <p className="ion-text-center ion-padding">
              لا يوجد عملاء بعد. أضف أول عميل بالزر بالأسفل ➕
            </p>
          </IonText>
        ) : visible.length === 0 ? (
          <IonText color="medium">
            <p className="ion-text-center ion-padding">لا توجد نتائج للبحث.</p>
          </IonText>
        ) : (
          // Tapping a row opens the customer detail (transactions + add
          // debt/payment) — wired in the next Phase 6 slice.
          <IonList>
            {visible.map(({ customer, balance }) => (
              <IonItem key={customer.id}>
                <IonLabel>
                  <h2>{customer.name}</h2>
                  <p>{customer.phone}</p>
                </IonLabel>
                <BalanceTag slot="end" balance={balance} />
              </IonItem>
            ))}
          </IonList>
        )}

        <IonFab slot="fixed" vertical="bottom" horizontal="start">
          <IonFabButton onClick={() => { resetForm(); void modal.current?.present(); }}>
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>

        <IonModal ref={modal} onDidDismiss={resetForm}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>عميل جديد</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => modal.current?.dismiss()}>إلغاء</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonItem>
              <IonLabel position="stacked">الاسم</IonLabel>
              <IonInput
                value={name}
                onIonInput={(e) => setName(e.detail.value ?? '')}
                placeholder="اسم العميل"
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">رقم الهاتف</IonLabel>
              <IonInput
                type="tel"
                inputmode="tel"
                value={phone}
                onIonInput={(e) => setPhone(e.detail.value ?? '')}
                placeholder="7XXXXXXXX"
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

            <IonButton expand="block" onClick={save} disabled={saving} className="ion-margin-top">
              {saving ? <IonSpinner name="crescent" /> : 'حفظ'}
            </IonButton>
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

// Running balance, colored by direction. Positive = the customer owes the shop
// (red); negative = the shop owes the customer / overpaid (green); zero = settled.
const BalanceTag: React.FC<{ balance: number; slot?: string }> = ({ balance, slot }) => {
  const color = balance > 0 ? 'danger' : balance < 0 ? 'success' : 'medium';
  const label = balance > 0 ? 'عليه' : balance < 0 ? 'له' : 'مسدد';
  return (
    <IonText slot={slot} color={color}>
      <div style={{ textAlign: 'end' }}>
        <strong>{formatMinor(Math.abs(balance))} {CURRENCY}</strong>
        <div style={{ fontSize: '0.75em' }}>{label}</div>
      </div>
    </IonText>
  );
};

export default Home;
