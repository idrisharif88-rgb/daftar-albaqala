import { useCallback, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonButton,
  IonBackButton, IonList, IonItem, IonLabel, IonText, IonSpinner, IonIcon,
  IonSearchbar, IonNote, IonFooter, IonLoading, IonModal, IonChip,
  IonItemSliding, IonItemOptions, IonItemOption,
  useIonViewWillEnter, useIonAlert, useIonRouter, useIonToast,
} from '@ionic/react';
import {
  addCircle, removeCircle, printOutline, trashOutline, bookmarksOutline,
  bookmarkOutline, closeCircleOutline,
} from 'ionicons/icons';
import { getCustomer, type Customer } from '../data/customers';
import { listItems, type Item } from '../data/items';
import {
  listGroups, createGroup, deleteGroup, type ItemGroup,
} from '../data/itemGroups';
import { addTransaction } from '../data/transactions';
import { formatMinor } from '../data/money';
import { nextInvoiceNumber, peekInvoiceNumber } from '../data/docNumber';
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
//
// Recording is a THREE-step act — pick, review, record — because the picking
// screen cannot show the basket. Tapping ＋ four times down a long list leaves
// the owner with a total and no way to check what produced it, and the entry
// that follows is append-only: a wrong basket is corrected by a reversing
// entry, in front of the person it was rung up for. So the basket is laid out
// in full first, as an invoice, and only «تأكيد» opens the two ways of
// recording it.

const Invoice: React.FC = () => {
  const { id: customerId } = useParams<{ id: string }>();
  const router = useIonRouter();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [rates, setRates] = useState<Rates>(DEFAULT_RATES);
  const [presentAlert] = useIonAlert();
  const [presentToast] = useIonToast();
  // Same SMS + WhatsApp flow the contact screen uses.
  const notifyContact = useContactNotifier();
  // Synchronous guard — `busy` lands a render late, and a double tap on «حفظ»
  // would otherwise record the basket twice (see CustomerDetail).
  const savingRef = useRef(false);

  // itemId → quantity. A count on the line is not stock-keeping; it is how you
  // say "three of these" without entering the same item three times.
  const [qty, setQty] = useState<Record<string, number>>({});

  // The review sheet, and which of its two steps is showing. 'review' is the
  // basket laid out as an invoice; 'confirm' is the two ways to record it.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [step, setStep] = useState<'review' | 'confirm'>('review');
  const [groupsOpen, setGroupsOpen] = useState(false);

  const load = useCallback(async () => {
    const [c, list, savedGroups, currentRates] = await Promise.all([
      getCustomer(customerId), listItems(customerId), listGroups(customerId), getRates(),
    ]);
    setCustomer(c);
    setItems(list);
    setGroups(savedGroups);
    setRates(currentRates);
    setLoading(false);
  }, [customerId]);

  useIonViewWillEnter(() => { void load(); });

  const itemById = new Map(items.map((i) => [i.id, i]));

  const basket = items
    .filter((i) => (qty[i.id] ?? 0) > 0)
    .map((i) => ({ item: i, qty: qty[i.id] }));

  const lines: InvoiceLine[] = basket.map(({ item, qty: count }) => ({
    name: item.name,
    qty: count,
    unitPrice: item.price,
    currency: item.currency,
    total: item.price * count,
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

  const clearBasket = () => {
    setQty({});
    setReviewOpen(false);
  };

  // ---- Saved baskets ----
  //
  // Applying a group ADDS to what is already on the invoice rather than
  // replacing it: the usual week's basket plus the one extra thing is the
  // common case, and a group that wiped the two items just picked would be a
  // trap. Two things can be missing by the time a group is used, and both are
  // reported rather than quietly dropped: an item deleted from the price list
  // since the group was saved, and an item whose currency no longer matches
  // this invoice.
  const applyGroup = (group: ItemGroup) => {
    let missing = 0;
    let wrongCurrency = 0;
    // Worked out here rather than inside a setQty updater: the updater runs
    // when React gets round to it, so the two counters below would still be
    // zero by the time the toast reports them.
    const next = { ...qty };
    // The currency in force: what the basket already is, or — for an empty
    // basket — whatever the group's first surviving item is in.
    let currency: CurrencyCode | null = lines.length > 0 ? invoiceCurrency : null;
    for (const line of group.lines) {
      const item = itemById.get(line.item_id);
      if (!item) { missing++; continue; }
      if (currency === null) currency = item.currency;
      if (item.currency !== currency) { wrongCurrency++; continue; }
      next[item.id] = (next[item.id] ?? 0) + line.qty;
    }
    setQty(next);

    const problems: string[] = [];
    if (missing > 0) problems.push(`${missing} صنف محذوف`);
    if (wrongCurrency > 0) problems.push(`${wrongCurrency} صنف بعملة مختلفة`);
    presentToast({
      message: problems.length > 0
        ? `أُضيفت «${group.name}» — تم تخطي ${problems.join(' و')}`
        : `أُضيفت «${group.name}»`,
      duration: problems.length > 0 ? 3000 : 1500,
      position: 'bottom',
    });
    setGroupsOpen(false);
  };

  const saveAsGroup = () => {
    if (lines.length === 0) return;
    presentAlert({
      header: 'حفظ كمجموعة',
      message: 'اسم المجموعة، مثل: الطلب الأسبوعي',
      inputs: [{ name: 'name', type: 'text', placeholder: 'اسم المجموعة' }],
      buttons: [
        { text: 'إلغاء', role: 'cancel' },
        {
          text: 'حفظ',
          handler: (data: { name?: string }) => {
            void (async () => {
              try {
                await createGroup({
                  customerId,
                  name: data.name ?? '',
                  lines: basket.map(({ item, qty: count }) => ({
                    item_id: item.id, qty: count,
                  })),
                });
                setGroups(await listGroups(customerId));
                void runSync(); // fire-and-forget; the group belongs to the account
                presentToast({ message: 'تم حفظ المجموعة', duration: 1500, position: 'bottom' });
              } catch (err) {
                presentAlert({
                  header: 'تعذّر الحفظ',
                  message: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
                  buttons: ['حسناً'],
                });
              }
            })();
          },
        },
      ],
    });
  };

  const confirmDeleteGroup = (group: ItemGroup) => {
    presentAlert({
      header: 'حذف المجموعة',
      // Worth saying plainly: a group holds no money, so nothing is lost with it.
      message: `حذف «${group.name}»؟ الأصناف وأسعارها والحركات المسجّلة لا تتأثر.`,
      buttons: [
        { text: 'إلغاء', role: 'cancel' },
        {
          text: 'حذف',
          role: 'destructive',
          handler: () => {
            void (async () => {
              await deleteGroup(group.id);
              setGroups(await listGroups(customerId));
              void runSync();
            })();
          },
        },
      ],
    });
  };

  // The role decides which of the two stored types GROWS what is owed. Against
  // a صاحب متجر — a shop the owner buys from — the entry that grows the debt is
  // the one stored as 'payment'. Buying on credit is always the growing one,
  // whichever name and sign that role gives it.
  const role = customer?.role ?? 'customer';
  const [growthType] = orderedTypes(role);
  const entryLabel = directionLabel(role, growthType);

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
      // The number the invoice WILL take. It is only consumed inside `commit`,
      // so an invoice abandoned at the send sheet leaves no gap in the book
      // (see docNumber.ts) — but the message has to quote it, and the
      // message is built before the entry exists.
      const number = await peekInvoiceNumber();
      const issuedAt = new Date();
      const breakdown = lines.map((l) => `${l.name} ×${l.qty}`).join('، ');
      // The number leads the note, so the entry in the history, the receipt on
      // the counter and the message on the phone all name the same invoice.
      const note = `فاتورة رقم ${number}: ${breakdown}`;
      const commit = async () => {
        await nextInvoiceNumber(); // consume the number this invoice quoted
        await addTransaction({
          customerId,
          type: growthType,
          amount: total,
          currency: invoiceCurrency,
          note,
        });
        void runSync();
      };

      // Recording WITHOUT printing goes through the ordinary notification
      // flow — the same SMS and WhatsApp offer as an entry typed by hand, so
      // the contact hears about a basket exactly as they hear about a single
      // debt, itemised the way the paper invoice book itemises it. Nothing is
      // written until a channel is chosen: no notice, no debt.
      if (!thenPrint) {
        // Drop the spinner first: it is a full-screen overlay and would sit on
        // top of the send sheet it is about to wait on.
        setBusy(null);
        const recorded = await notifyContact({
          customerId, type: growthType, amount: total, currency: invoiceCurrency, note,
          invoice: { number, issuedAt, lines },
          commit,
        });
        // Cancelled: the basket is left exactly as it was, so the owner can
        // change it and try again rather than tapping it all in a second time.
        if (!recorded) return;
        setQty({});
        setReviewOpen(false);
        router.goBack();
        return;
      }

      // With a printed receipt the paper IS the notice, so the entry is
      // recorded here and no message is offered.
      await commit();
      setBusy('جارٍ الطباعة...');
      const settings = await getSettings();
      // Loaded on demand: the printer driver and the receipt renderer are dead
      // weight in a session that never prints.
      const { printReceipt } = await import('../lib/print');
      await printReceipt({
        storeName: messageSender(settings),
        contactName: customer.name,
        roleLabel: roleDef(role).labelAr,
        entryLabel,
        number,
        lines,
        total,
        currency: invoiceCurrency,
        issuedAt,
        rates,
      });

      setQty({});
      setReviewOpen(false);
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

  const openReview = () => {
    setStep('review');
    setReviewOpen(true);
  };

  const term = search.trim().toLowerCase();
  const visible = term ? items.filter((i) => i.name.toLowerCase().includes(term)) : items;
  const short = currencyDef(invoiceCurrency).shortAr;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref={`/customers/${customerId}`} text="رجوع" />
          </IonButtons>
          <IonTitle>فاتورة {customer?.name ?? ''}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => setGroupsOpen(true)} aria-label="المجموعات">
              <IonIcon slot="icon-only" icon={bookmarksOutline} />
            </IonButton>
          </IonButtons>
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
        {/* The saved baskets, one tap from the top of the list — the whole
            point of a group is not having to go looking for it. */}
        {groups.length > 0 && (
          <div className="group-chips">
            {groups.map((g) => (
              <IonChip key={g.id} onClick={() => applyGroup(g)}>
                <IonIcon icon={bookmarkOutline} />
                <IonLabel>{g.name}</IonLabel>
              </IonChip>
            ))}
          </div>
        )}

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

        {/* ---- Review, then confirm ---- */}
        <IonModal isOpen={reviewOpen} onDidDismiss={() => setReviewOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>
                {step === 'review' ? 'مراجعة الفاتورة' : `تأكيد ${entryLabel}`}
              </IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setReviewOpen(false)}>إغلاق</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="ion-padding">
            {/* The paper invoice's four columns, in the same order the owner
                writes them by hand: الصنف | السعر | الكمية | الإجمالي. */}
            <div className="inv-table">
              <div className="inv-table__row inv-table__row--head">
                <span>الصنف</span>
                <span>السعر</span>
                <span>الكمية</span>
                <span>الإجمالي</span>
              </div>
              {basket.map(({ item, qty: count }) => (
                <div className="inv-table__row" key={item.id}>
                  <span className="inv-table__name">{item.name}</span>
                  <span>{formatMinor(item.price)}</span>
                  <span>
                    {step === 'review' ? (
                      // Editable while reviewing: the mistake this screen
                      // exists to catch is a quantity, so fixing it must not
                      // mean going back and hunting the row down again.
                      <span className="inv-table__qty">
                        <IonButton
                          fill="clear"
                          size="small"
                          onClick={() => bump(item, -1)}
                          aria-label="إنقاص"
                        >
                          <IonIcon slot="icon-only" icon={removeCircle} />
                        </IonButton>
                        <b>{count}</b>
                        <IonButton
                          fill="clear"
                          size="small"
                          onClick={() => bump(item, 1)}
                          aria-label="زيادة"
                        >
                          <IonIcon slot="icon-only" icon={addCircle} />
                        </IonButton>
                      </span>
                    ) : (
                      count
                    )}
                  </span>
                  <span>{formatMinor(item.price * count)}</span>
                </div>
              ))}
              <div className="inv-table__row inv-table__row--total">
                <span>الإجمالي</span>
                <span />
                <span />
                <span>{formatMinor(total)} {short}</span>
              </div>
            </div>

            {step === 'review' && (
              <div className="inv-review__extras">
                <IonButton fill="clear" size="small" onClick={saveAsGroup}>
                  <IonIcon slot="start" icon={bookmarkOutline} />
                  حفظ كمجموعة
                </IonButton>
                <IonButton fill="clear" size="small" color="medium" onClick={clearBasket}>
                  <IonIcon slot="start" icon={closeCircleOutline} />
                  تفريغ الفاتورة
                </IonButton>
              </div>
            )}

            {step === 'confirm' && (
              <IonNote className="inv-review__hint">
                بعد التسجيل لا يمكن تعديل الحركة — التصحيح يكون بحركة عكسية.
              </IonNote>
            )}
          </IonContent>

          <IonFooter>
            <div className="inv-review__actions">
              {step === 'review' ? (
                <>
                  {/* «إلغاء» closes the review and leaves the basket as it is —
                      cancelling a confirmation must not destroy the work that
                      was being confirmed. «تفريغ الفاتورة» above is the way to
                      actually empty it. */}
                  <IonButton fill="outline" onClick={() => setReviewOpen(false)}>
                    إلغاء
                  </IonButton>
                  <IonButton onClick={() => setStep('confirm')} disabled={lines.length === 0}>
                    تأكيد
                  </IonButton>
                </>
              ) : (
                <>
                  {/* Both buttons record the SAME entry; they differ only in
                      what happens afterwards. Named from the role, so a
                      صاحب متجر reads «تسجيل دين» — the label must match the
                      button the owner presses on the contact screen for the
                      same act. */}
                  <IonButton fill="clear" color="medium" onClick={() => setStep('review')}>
                    رجوع
                  </IonButton>
                  <IonButton onClick={() => { void save(false); }}>{entryLabel}</IonButton>
                  <IonButton fill="outline" onClick={() => { void save(true); }}>
                    <IonIcon slot="start" icon={printOutline} />
                    {entryLabel} وطباعة
                  </IonButton>
                </>
              )}
            </div>
          </IonFooter>
        </IonModal>

        {/* ---- Saved baskets ---- */}
        <IonModal isOpen={groupsOpen} onDidDismiss={() => setGroupsOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>المجموعات</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setGroupsOpen(false)}>إغلاق</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent>
            {groups.length === 0 ? (
              <IonText color="medium">
                <p className="ion-text-center ion-padding">
                  لا توجد مجموعات. اختر الأصناف التي تشتريها عادةً ثم احفظها كمجموعة
                  لتسجّلها لاحقاً بضغطة واحدة.
                </p>
              </IonText>
            ) : (
              <IonList>
                {groups.map((g) => (
                  <IonItemSliding key={g.id}>
                    <IonItem button onClick={() => applyGroup(g)}>
                      <IonIcon slot="start" icon={bookmarkOutline} />
                      <IonLabel>
                        <h2>{g.name}</h2>
                        <p>{g.lines.length} صنف</p>
                      </IonLabel>
                    </IonItem>
                    <IonItemOptions side="end">
                      <IonItemOption color="danger" onClick={() => confirmDeleteGroup(g)}>
                        <IonIcon slot="icon-only" icon={trashOutline} />
                      </IonItemOption>
                    </IonItemOptions>
                  </IonItemSliding>
                ))}
              </IonList>
            )}
            <div className="ion-padding">
              <IonButton
                expand="block"
                fill="outline"
                onClick={saveAsGroup}
                disabled={lines.length === 0}
              >
                <IonIcon slot="start" icon={bookmarkOutline} />
                حفظ الأصناف المختارة كمجموعة
              </IonButton>
              {lines.length === 0 && (
                <IonNote className="inv-review__hint">
                  اختر أصنافاً أولاً لتتمكن من حفظها كمجموعة.
                </IonNote>
              )}
            </div>
          </IonContent>
        </IonModal>
      </IonContent>

      {lines.length > 0 && (
        <IonFooter>
          <div className="invoice-bar">
            <div className="invoice-bar__total">
              الإجمالي: <strong>{formatMinor(total)} {short}</strong>
              <IonNote className="invoice-bar__count">
                {' '}({lines.length} صنف)
              </IonNote>
            </div>
            <div className="invoice-bar__actions">
              <IonButton onClick={openReview}>مراجعة الفاتورة</IonButton>
            </div>
          </div>
        </IonFooter>
      )}
    </IonPage>
  );
};

export default Invoice;
