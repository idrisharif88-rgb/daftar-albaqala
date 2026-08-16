import { useCallback, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonButton,
  IonBackButton, IonList, IonItem, IonLabel, IonText, IonSpinner, IonIcon,
  IonSearchbar, IonNote, IonFooter, IonLoading,
  useIonViewWillEnter, useIonAlert, useIonRouter,
} from '@ionic/react';
import { addCircle, removeCircle, printOutline } from 'ionicons/icons';
import { getCustomer, type Customer } from '../data/customers';
import { listItems, type Item } from '../data/items';
import { addTransaction } from '../data/transactions';
import { formatMinor } from '../data/money';
import { runSync } from '../data/sync';
import { getSettings, messageSender } from '../data/settings';
import { getRates } from '../data/rates';
import {
  BASE_CURRENCY, currencyDef, formatAmount, DEFAULT_RATES, type CurrencyCode, type Rates,
} from '../data/currencies';
import { directionLabel, orderedTypes, roleDef } from '../data/roles';
import { isAccountActive, INACTIVE_MESSAGE } from '../data/account';
import { useContactNotifier } from '../lib/useContactNotifier';
import type { InvoiceLine } from '../lib/receipt';

// Build one purchase out of the contact's price list, record it as a SINGLE
// entry, and print it.
//
// One entry, not one per item, and that is deliberate. The ledger's unit is
// what changed between two people — a basket bought in one visit moved the
// balance once. Recording eight rows would make the history unreadable and
// eight reversing entries necessary to undo one mistake. The item breakdown
// lives in the entry's note and on the printed receipt.
//
// Everything on one invoice must share a CURRENCY: a total is only meaningful
// within one, and the debt of record is the native amount (see currencies.ts).
// Picking an item in another currency swaps the invoice rather than mixing it.

const Invoice: React.FC = () => {
  const { id: customerId } = useParams<{ id: string }>();
  const router = useIonRouter();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [rates, setRates] = useState<Rates>(DEFAULT_RATES);
  const [presentAlert] = useIonAlert();
  // Same SMS + WhatsApp flow the contact screen uses.
  const notifyContact = useContactNotifier();
  // Synchronous guard — `busy` lands a render late, and a double tap on «حفظ»
  // would otherwise record the basket twice (see CustomerDetail).
  const savingRef = useRef(false);

  // itemId → quantity. A count on the line is not stock-keeping; it is how you
  // say "three of these" without entering the same item three times.
  const [qty, setQty] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    const [c, list, currentRates] = await Promise.all([
      getCustomer(customerId), listItems(customerId), getRates(),
    ]);
    setCustomer(c);
    setItems(list);
    setRates(currentRates);
    setLoading(false);
  }, [customerId]);

  useIonViewWillEnter(() => { void load(); });

  const lines: InvoiceLine[] = items
    .filter((i) => (qty[i.id] ?? 0) > 0)
    .map((i) => ({
      name: i.name,
      qty: qty[i.id],
      unitPrice: i.price,
      currency: i.currency,
      total: i.price * qty[i.id],
    }));

  // The invoice's currency is whatever its first line is in; everything else
  // is filtered against it.
  const invoiceCurrency: CurrencyCode = (lines[0]?.currency as CurrencyCode) ?? BASE_CURRENCY;
  const total = lines.reduce((sum, l) => sum + l.total, 0);

  const bump = (item: Item, delta: number) => {
    const current = qty[item.id] ?? 0;
    const next = Math.max(0, current + delta);
    // Adding the first line of a different currency: ask before discarding, so
    // a basket is never silently emptied.
    if (next > 0 && lines.length > 0 && item.currency !== invoiceCurrency) {
      presentAlert({
        header: 'عملة مختلفة',
        message: `الفاتورة الحالية بـ${currencyDef(invoiceCurrency).longAr}. إضافة صنف بـ${currencyDef(item.currency).longAr} تبدأ فاتورة جديدة.`,
        buttons: [
          { text: 'إلغاء', role: 'cancel' },
          { text: 'ابدأ فاتورة جديدة', handler: () => setQty({ [item.id]: 1 }) },
        ],
      });
      return;
    }
    setQty((q) => {
      const copy = { ...q };
      if (next === 0) delete copy[item.id];
      else copy[item.id] = next;
      return copy;
    });
  };

  // The role decides which of the two stored types GROWS what is owed. Against
  // a صاحب متجر — a shop the owner buys from — the entry that grows the debt is
  // the one stored as 'payment'. Buying on credit is always the growing one,
  // whichever name and sign that role gives it.
  const role = customer?.role ?? 'customer';
  const [growthType] = orderedTypes(role);

  const save = async (thenPrint: boolean) => {
    if (!customer || lines.length === 0) return;
    if (!(await isAccountActive())) {
      presentAlert({ header: 'حساب غير مفعّل', message: INACTIVE_MESSAGE, buttons: ['حسناً'] });
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setBusy('جارٍ الحفظ...');
    try {
      const note = lines.map((l) => `${l.name} ×${l.qty}`).join('، ');
      await addTransaction({
        customerId,
        type: growthType,
        amount: total,
        currency: invoiceCurrency,
        note,
      });
      void runSync();

      // Recording WITHOUT printing goes through the ordinary notification
      // flow — the same SMS and WhatsApp offer as an entry typed by hand, so
      // the contact hears about a basket exactly as they hear about a single
      // debt. With a printed receipt the paper IS the notice, so it is not
      // also sent as a message.
      if (!thenPrint) {
        setQty({});
        await notifyContact({
          customerId, type: growthType, amount: total, currency: invoiceCurrency, note,
        });
        router.goBack();
        return;
      }

      setBusy('جارٍ الطباعة...');
      const settings = await getSettings();
      // Loaded on demand: the printer driver and the receipt renderer are dead
      // weight in a session that never prints.
      const { printReceipt } = await import('../lib/print');
      await printReceipt({
        storeName: messageSender(settings),
        contactName: customer.name,
        roleLabel: roleDef(role).labelAr,
        entryLabel: directionLabel(role, growthType),
        lines,
        total,
        currency: invoiceCurrency,
        issuedAt: new Date(),
        rates,
      });

      setQty({});
      router.goBack();
    } catch (err) {
      presentAlert({
        header: thenPrint ? 'تعذّرت الطباعة' : 'خطأ',
        // The entry is already saved when printing fails — say so, or the owner
        // records the same basket a second time.
        message: `${err instanceof Error ? err.message : 'حدث خطأ غير متوقع'}${
          thenPrint ? '\n\nالحركة محفوظة. يمكنك الطباعة لاحقاً.' : ''
        }`,
        buttons: ['حسناً'],
      });
    } finally {
      setBusy(null);
      savingRef.current = false;
    }
  };

  const term = search.trim().toLowerCase();
  const visible = term ? items.filter((i) => i.name.toLowerCase().includes(term)) : items;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref={`/customers/${customerId}`} text="رجوع" />
          </IonButtons>
          <IonTitle>فاتورة {customer?.name ?? ''}</IonTitle>
        </IonToolbar>
        <IonToolbar>
          <IonSearchbar
            value={search}
            onIonInput={(e) => setSearch(e.detail.value ?? '')}
            placeholder="بحث عن صنف"
          />
        </IonToolbar>
      </IonHeader>

      <IonContent>
        {loading ? (
          <div className="ion-text-center ion-padding">
            <IonSpinner name="crescent" />
          </div>
        ) : items.length === 0 ? (
          <IonText color="medium">
            <p className="ion-text-center ion-padding">
              لا توجد أصناف مسجّلة لهذه الجهة.
            </p>
            <div className="ion-padding">
              <IonButton expand="block" fill="outline" routerLink={`/customers/${customerId}/items`}>
                إضافة الأصناف
              </IonButton>
            </div>
          </IonText>
        ) : visible.length === 0 ? (
          <IonText color="medium">
            <p className="ion-text-center ion-padding">الصنف غير مسجل</p>
          </IonText>
        ) : (
          <IonList>
            {visible.map((item) => {
              const count = qty[item.id] ?? 0;
              return (
                <IonItem key={item.id}>
                  <IonLabel>
                    <h2>{item.name}</h2>
                    <p>{formatAmount(item.price, item.currency)}</p>
                  </IonLabel>
                  <div slot="end" className="qty-stepper">
                    <IonButton
                      fill="clear"
                      onClick={() => bump(item, -1)}
                      disabled={count === 0}
                      aria-label="إنقاص"
                    >
                      <IonIcon slot="icon-only" icon={removeCircle} />
                    </IonButton>
                    <span className="qty-stepper__count">{count}</span>
                    <IonButton fill="clear" onClick={() => bump(item, 1)} aria-label="زيادة">
                      <IonIcon slot="icon-only" icon={addCircle} />
                    </IonButton>
                  </div>
                </IonItem>
              );
            })}
          </IonList>
        )}

        <IonLoading isOpen={busy !== null} message={busy ?? ''} />
      </IonContent>

      {lines.length > 0 && (
        <IonFooter>
          <div className="invoice-bar">
            <div className="invoice-bar__total">
              الإجمالي: <strong>{formatMinor(total)} {currencyDef(invoiceCurrency).shortAr}</strong>
              <IonNote className="invoice-bar__count">
                {' '}({lines.length} صنف)
              </IonNote>
            </div>
            {/* Both buttons record the SAME entry; they differ only in what
                happens afterwards. Named from the role, so a صاحب متجر reads
                «تسجيل دين» — the label must match the button the owner presses
                on the contact screen for the same act. */}
            <div className="invoice-bar__actions">
              <IonButton onClick={() => { void save(false); }}>
                {directionLabel(role, growthType)}
              </IonButton>
              <IonButton fill="outline" onClick={() => { void save(true); }}>
                <IonIcon slot="start" icon={printOutline} />
                {directionLabel(role, growthType)} وطباعة
              </IonButton>
            </div>
          </div>
        </IonFooter>
      )}
    </IonPage>
  );
};

export default Invoice;
