import { useCallback, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonButton,
  IonBackButton, IonList, IonItem, IonLabel, IonText, IonSpinner, IonModal,
  IonInput, IonNote, IonGrid, IonRow, IonCol, useIonViewWillEnter,
} from '@ionic/react';
import { getCustomer, type Customer } from '../data/customers';
import {
  listTransactions, getBalance, addTransaction, type Transaction, type TxnType,
} from '../data/transactions';
import { formatMinor, toMinor } from '../data/money';

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

  const openForm = (type: TxnType) => {
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
    setSaving(true);
    try {
      await addTransaction({
        customerId,
        type: formType,
        amount: toMinor(major),
        note: note.trim() || null,
      });
      await load();
      await modal.current?.dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSaving(false);
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
            <IonText color={balanceColor}>
              <div className="ion-text-center ion-padding">
                <div style={{ fontSize: '1.6em' }}>
                  <strong>{formatMinor(Math.abs(balance))} {CURRENCY}</strong>
                </div>
                <div>{balanceLabel}</div>
              </div>
            </IonText>

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
      </IonContent>
    </IonPage>
  );
};

export default CustomerDetail;
