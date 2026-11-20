import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonInput, IonItem, IonLabel, IonList,
  IonModal, IonNote, IonPage, IonSelect, IonSelectOption, IonTitle, IonToolbar, useIonToast, useIonViewWillEnter,
} from '@ionic/react';
import { getCustomer, type Customer } from '../../data/customers';
import { addTransaction, getBalances, listTransactions, type Transaction } from '../../data/transactions';
import { formatMinor, toMinor } from '../../data/money';
import { runSync } from '../../data/sync';
import { numericInput } from '../../lib/digits';
import { listPackages, type ClubPackage } from './packages';
import {
  createSubscription, daysBetween, listSubscriptions, nextStart, statusOf, today, addDays, subscriptionNote,
  type ClubSubscription,
} from './subscriptions';
import { chipText } from './ClubHome';
import { useContactNotifier } from '../../lib/useContactNotifier';
import { arabicDate, paymentMessage, subscriptionMessage } from './messages';

// A subscriber's card (Phase 43, step 3): the current subscription with its
// dates and days left, what is still owed, «اشتراك جديد» and «تسجيل دفعة»,
// and the history. The price of a subscription can differ per subscriber —
// the package's price is the starting point, the owner may lower it (discount).
// Both the subscription and a payment go out to the subscriber by WhatsApp or
// SMS through the same notifier as the grocery book — and, as there, nothing
// is recorded unless the notice goes (useContactNotifier: «no notice, no entry»).

const ClubMember: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [member, setMember] = useState<Customer | null>(null);
  const [subs, setSubs] = useState<ClubSubscription[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [owed, setOwed] = useState(0);
  const [packages, setPackages] = useState<ClubPackage[]>([]);
  const [presentToast] = useIonToast();
  const notifyContact = useContactNotifier();

  // «اشتراك جديد»
  const [subOpen, setSubOpen] = useState(false);
  const [pkgId, setPkgId] = useState<string>('');
  const [price, setPrice] = useState('');
  const [start, setStart] = useState(today());
  const [subErr, setSubErr] = useState<string | null>(null);
  // «تسجيل دفعة»
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [payErr, setPayErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [m, s, t, b, p] = await Promise.all([
      getCustomer(id), listSubscriptions(id), listTransactions(id), getBalances(id), listPackages(),
    ]);
    setMember(m);
    setSubs(s);
    setTxns(t);
    setOwed(b.find((x) => x.currency === 'YER')?.minor ?? 0);
    setPackages(p);
  }, [id]);

  useIonViewWillEnter(() => { void load(); });

  const current = subs[0] ?? null;
  const { status, left } = statusOf(current);
  const pkg = packages.find((p) => p.id === pkgId) ?? null;
  const priceMinor = price.trim() ? toMinor(Number(price)) : NaN;
  const discount = pkg && Number.isFinite(priceMinor) ? pkg.price - priceMinor : 0;

  const openSub = () => {
    const first = packages[0];
    setPkgId(first?.id ?? '');
    setPrice(first ? String(first.price / 100) : '');
    setStart(nextStart(current));
    setSubErr(null);
    setSubOpen(true);
  };

  const pickPackage = (pid: string) => {
    setPkgId(pid);
    const p = packages.find((x) => x.id === pid);
    if (p) setPrice(String(p.price / 100)); // each choice starts from the list price
  };

  const sell = async () => {
    if (!pkg || busy) return;
    if (!Number.isFinite(priceMinor) || priceMinor < 0) { setSubErr('أدخل سعراً صحيحاً'); return; }
    if (priceMinor > pkg.price) { setSubErr('السعر أعلى من سعر الباقة'); return; }
    setBusy(true);
    try {
      const input = {
        customerId: id, packageName: pkg.name, days: pkg.days,
        listPrice: pkg.price, price: priceMinor, startDate: start,
      };
      const commit = async () => { await createSubscription(input); };
      // A free subscription has no amount to announce: record it directly.
      const endDate = addDays(start, pkg.days - 1);
      const recorded = priceMinor > 0
        ? await notifyContact({
          customerId: id, type: 'debt', amount: priceMinor, currency: 'YER',
          note: subscriptionNote(input), commit,
          compose: ({ senderName, balanceAfter }) => subscriptionMessage({
            club: senderName, packageName: pkg.name, price: priceMinor, listPrice: pkg.price, endDate, balanceAfter,
          }),
        })
        : (await commit(), true);
      if (!recorded) return; // the notice was cancelled — nothing recorded
      setSubOpen(false);
      void runSync();
      void presentToast({ message: 'تم تسجيل الاشتراك ✓', duration: 1600, color: 'success' });
      await load();
    } catch (err) {
      setSubErr(err instanceof Error ? err.message : 'تعذّر الحفظ');
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    const minor = toMinor(Number(amount));
    if (!amount.trim() || !Number.isFinite(minor) || minor <= 0) { setPayErr('أدخل مبلغاً صحيحاً'); return; }
    if (busy) return;
    setBusy(true);
    try {
      const recorded = await notifyContact({
        customerId: id, type: 'payment', amount: minor, currency: 'YER', note: 'دفعة اشتراك',
        commit: async () => { await addTransaction({ customerId: id, type: 'payment', amount: minor, note: 'دفعة اشتراك' }); },
        compose: ({ senderName, balanceAfter }) => paymentMessage({
          club: senderName, amount: minor, balanceAfter, endDate: current?.end_date ?? null,
        }),
      });
      if (!recorded) return;
      setPayOpen(false);
      setAmount('');
      void runSync();
      void presentToast({ message: 'تم تسجيل الدفعة ✓', duration: 1600, color: 'success' });
      await load();
    } catch (err) {
      setPayErr(err instanceof Error ? err.message : 'تعذّر الحفظ');
    } finally {
      setBusy(false);
    }
  };

  const total = current ? current.days : 0;
  const used = current ? Math.min(total, Math.max(0, daysBetween(current.start_date, today()) + 1)) : 0;

  return (
    <IonPage className="club">
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/club" text="رجوع" /></IonButtons>
          <IonTitle>{member?.name ?? ''}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div className="club-card">
          <div className="club-card__head">
            <span>{current ? current.package_name : 'لا يوجد اشتراك'}</span>
            {current && <span className={`club-chip club-chip--${status}`}>{chipText(status, left)}</span>}
          </div>
          {current && (
            <>
              <div className="club-dates">
                <span><i className="club-tri club-tri--up" aria-label="البداية" />{arabicDate(current.start_date)}</span>
                <span><i className="club-tri club-tri--down" aria-label="النهاية" />{arabicDate(current.end_date)}</span>
              </div>
              <div className="club-prog" aria-hidden="true"><i style={{ width: `${total ? (100 * used) / total : 0}%` }} /></div>
              <div className="club-money club-money--sub">
                <span>{status === 'expired' ? `انتهى منذ ${-left} يوم` : `اليوم ${used} من ${total}`}</span>
                <span>
                  {formatMinor(current.price)} ر.ي
                  {current.price < current.list_price && <em> · خصم {formatMinor(current.list_price - current.price)}</em>}
                </span>
              </div>
            </>
          )}
          <div className="club-money">
            <span>{member?.phone}</span>
            <span className={owed > 0 ? 'club-owed' : 'club-paid'}>
              {owed > 0 ? `متبقٍّ ${formatMinor(owed)} ر.ي` : owed < 0 ? `له ${formatMinor(-owed)} ر.ي` : 'مسدد'}
            </span>
          </div>
        </div>

        <div className="club-acts">
          <IonButton className="club-btn" onClick={openSub}>{current ? 'تجديد / اشتراك جديد' : 'اشتراك جديد'}</IonButton>
          <IonButton fill="outline" className="club-btn-out" onClick={() => { setAmount(owed > 0 ? String(owed / 100) : ''); setPayErr(null); setPayOpen(true); }}>
            تسجيل دفعة
          </IonButton>
        </div>

        <div className="club-hist">
          {txns.map((t) => (
            <div key={t.id} className="club-h">
              <span>{t.type === 'debt' ? 'اشتراك' : 'دفعة'} · {arabicDate(t.created_at.slice(0, 10))}</span>
              <b>{formatMinor(t.amount)}</b>
            </div>
          ))}
        </div>

        {/* ---- اشتراك جديد ---- */}
        <IonModal className="club-sheet" isOpen={subOpen} onDidDismiss={() => setSubOpen(false)} initialBreakpoint={0.75} breakpoints={[0, 0.75, 1]}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>اشتراك جديد</IonTitle>
              <IonButtons slot="end"><IonButton onClick={() => setSubOpen(false)}>إلغاء</IonButton></IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            {packages.length === 0 ? (
              <div className="club-empty">
                <p>لا توجد باقات بعد.</p>
                <IonButton routerLink="/club/packages" onClick={() => setSubOpen(false)} className="club-btn">إضافة الباقات</IonButton>
              </div>
            ) : (
              <>
                <IonList>
                  <IonItem>
                    <IonSelect label="الباقة" labelPlacement="stacked" interface="popover" value={pkgId}
                      onIonChange={(e) => pickPackage(String(e.detail.value))}>
                      {packages.map((p) => (
                        <IonSelectOption key={p.id} value={p.id}>{p.name} — {formatMinor(p.price)} ر.ي · {p.days} يوم</IonSelectOption>
                      ))}
                    </IonSelect>
                  </IonItem>
                  <div className="club-two">
                  <IonItem>
                    <IonInput label="سعر هذا المشترك" labelPlacement="stacked" type="text" inputmode="decimal" value={price}
                      onIonInput={(e) => setPrice(numericInput(e.detail.value ?? ''))} />
                  </IonItem>
                  <IonItem>
                    <IonInput label="يبدأ في" labelPlacement="stacked" type="date" value={start}
                      onIonChange={(e) => setStart(String(e.detail.value || today()))} />
                  </IonItem>
                  </div>
                </IonList>
                {pkg && (
                  <div className="club-summary">
                    <div><span><i className="club-tri club-tri--down" aria-hidden="true" />ينتهي</span><b>{arabicDate(addDays(start, pkg.days - 1))}</b></div>
                    {discount > 0 && <div><span>خصم</span><b>{formatMinor(discount)} ر.ي</b></div>}
                    <div><span>يُسجَّل دين</span><b>{Number.isFinite(priceMinor) ? formatMinor(priceMinor) : '—'} ر.ي</b></div>
                  </div>
                )}
                {subErr && <IonNote color="danger" className="club-err">{subErr}</IonNote>}
                <IonButton expand="block" className="club-btn ion-margin-top" disabled={!pkg || busy} onClick={() => void sell()}>
                  تسجيل الاشتراك وإرسال الإشعار
                </IonButton>
              </>
            )}
          </IonContent>
        </IonModal>

        {/* ---- تسجيل دفعة ---- */}
        <IonModal className="club-sheet" isOpen={payOpen} onDidDismiss={() => setPayOpen(false)} initialBreakpoint={0.5} breakpoints={[0, 0.5, 0.8]}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>تسجيل دفعة</IonTitle>
              <IonButtons slot="end"><IonButton onClick={() => setPayOpen(false)}>إلغاء</IonButton></IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonItem>
              <IonLabel position="stacked">المبلغ (ر.ي)</IonLabel>
              <IonInput type="text" inputmode="decimal" value={amount}
                onIonInput={(e) => setAmount(numericInput(e.detail.value ?? ''))} />
            </IonItem>
            {owed > 0 && <IonNote className="club-err">المتبقي {formatMinor(owed)} ر.ي — يمكن الدفع جزئياً.</IonNote>}
            {payErr && <IonNote color="danger" className="club-err">{payErr}</IonNote>}
            <IonButton expand="block" className="club-btn ion-margin-top" disabled={busy} onClick={() => void pay()}>حفظ الدفعة</IonButton>
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default ClubMember;
