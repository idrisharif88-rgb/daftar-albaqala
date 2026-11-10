import { useCallback, useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonButton, IonIcon, IonInput,
  IonItem, IonLabel, IonText, IonSpinner, IonToggle, IonSearchbar, IonList,
  useIonViewWillEnter, useIonAlert,
} from '@ionic/react';
import { ICONS } from './icons';
import PosFooter from './PosFooter';
import { findByScan, recordSale, getDayRows, totalsOf, type DayRow } from './stock';
import type { PosProduct } from './products';
import { formatMinor } from '../../data/money';
import { cameraScanAvailable, scanOne } from './scanner';
import { beepBad, beepOk, setSoundEnabled, soundEnabled, unlockAudio } from './beep';
import { parseScannedCode } from '../../lib/productCodes';
import { toLatinDigits } from '../../lib/digits';
import { usePosPermissions } from './permissions';
import { useAuth } from '../../lib/auth';
import { PIN_LENGTH, notePinAttempt, pinLockedMinutes, pinMatches } from './managerPin';
import { PosRefresher, RefreshButton, usePosRefresh } from './PosRefresh';

// «بيع» — sell by scanning the product's barcode, or by tapping its name.
//
//  • One scan = ONE sale. With «مسح متتابع» on, the camera reopens by itself
//    after every scan, so a queue of customers is item, item, item — he taps
//    back when done and sees what was sold.
//  • Tapping a name does the same sale with no camera, for a torn or smudged
//    label.
// «تراجع» takes back the last sale with an opposite entry.

// «تأكيد كل بيعة»: each sale waits for ✓ (green) or ✕ (red) before it is
// recorded — fewer undos. On by default; a switch on this screen turns it off.
const CONFIRM_KEY = 'daftar.pos.confirm-sale';
const readConfirm = (): boolean => {
  try { return localStorage.getItem(CONFIRM_KEY) !== '0'; } catch { return true; }
};
const CONT_KEY = 'daftar.pos.continuous';
const readContinuous = (): boolean => {
  try { return localStorage.getItem(CONT_KEY) !== '0'; } catch { return true; }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SellPage: React.FC = () => {
  const { staff } = useAuth();
  const [presentPin] = useIonAlert();
  const [rows, setRows] = useState<DayRow[]>([]);
  const [last, setLast] = useState<DayRow | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [session, setSession] = useState<{ name: string; n: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [continuous, setContinuous] = useState<boolean>(readContinuous);
  const [confirmSale, setConfirmSale] = useState<boolean>(readConfirm);
  const [sound, setSound] = useState<boolean>(soundEnabled);
  // A cashier sells without being shown the stock or the day's totals (the
  // list still holds only what is in stock — that is what makes it sellable).
  const can = usePosPermissions();
  const seeStock = can('see_stock');
  const seeReports = can('see_reports');

  const refresh = useCallback(async (): Promise<DayRow[]> => {
    const r = await getDayRows();
    setRows(r);
    return r;
  }, []);
  useIonViewWillEnter(() => { void refresh(); });
  const pull = usePosRefresh(refresh);

  const toggleSound = (on: boolean) => {
    setSound(on);
    setSoundEnabled(on);
    if (on) { unlockAudio(); beepOk(); } // let him hear what he just switched on
  };

  const toggleConfirm = (on: boolean) => {
    setConfirmSale(on);
    try { localStorage.setItem(CONFIRM_KEY, on ? '1' : '0'); } catch { /* a convenience only */ }
  };

  /** ✓ / ✕ for one sale. Resolves true to record it. Always true when off. */
  const confirmOne = (product: PosProduct) => new Promise<boolean>((resolve) => {
    if (!confirmSale) { resolve(true); return; }
    void presentPin({
      header: product.name,
      message: `${formatMinor(product.price)} ريال`,
      cssClass: 'mark-ask',
      backdropDismiss: false,
      buttons: [
        { text: '✕', role: 'cancel', htmlAttributes: { 'aria-label': 'إلغاء البيع' }, handler: () => resolve(false) },
        { text: '✓', cssClass: 'mark-yes', htmlAttributes: { 'aria-label': 'تأكيد البيع' }, handler: () => resolve(true) },
      ],
    });
  });

  /** Find what a code names, confirm, then record. */
  const sellScanned = async (raw: string): Promise<{ ok: true; row: DayRow } | { ok: false; reason: string }> => {
    const found = await findByScan(toLatinDigits(raw), parseScannedCode);
    if (!found.ok) return found;
    if (!(await confirmOne(found.product))) return { ok: false, reason: 'cancelled' };
    await recordSale(found.product, 1);
    const row = (await getDayRows()).find((r) => r.product.id === found.product.id)!;
    return { ok: true, row };
  };

  const toggleContinuous = (on: boolean) => {
    setContinuous(on);
    try { localStorage.setItem(CONT_KEY, on ? '1' : '0'); } catch { /* a convenience only */ }
  };

  // The browser has no camera scanner: a typed or pasted code stands in.
  const handleTyped = async (raw: string) => {
    unlockAudio();
    const out = await sellScanned(raw);
    if (out.ok) { beepOk(); setLast(out.row); setMessage(null); setSession(null); await refresh(); }
    else if (out.reason === 'cancelled') { setMessage('لم تُسجَّل البيعة.'); }
    else {
      beepBad();
      setLast(null);
      setMessage(out.reason === 'unknown-code' ? 'هذا ليس رمز أحد منتجاتك.' : 'الرمز غير مسجل. ربما حُذف المنتج.');
    }
  };

  const scan = async () => {
    unlockAudio(); // this tap is the gesture that lets the beeps play later
    setBusy(true);
    setMessage(null);
    const counts = new Map<string, number>();
    let unknown = 0;
    let lastRow: DayRow | null = null;
    try {
      for (;;) {
        const raw = await scanOne();
        if (!raw) break; // he backed out — the session is over
        const out = await sellScanned(raw);
        if (out.ok) {
          beepOk();
          counts.set(out.row.product.name, (counts.get(out.row.product.name) ?? 0) + 1);
          lastRow = out.row;
        } else if (out.reason === 'cancelled') {
          // ✕ — not sold; scanning goes on
        } else {
          beepBad();
          unknown += 1;
        }
        if (!continuous) break;
        await sleep(700); // let the item leave the camera before it reopens
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setBusy(false);
    }
    const fresh = await refresh();
    if (lastRow) setLast(fresh.find((r) => r.product.id === lastRow!.product.id) ?? lastRow);
    setSession(continuous && counts.size > 0
      ? [...counts].map(([name, n]) => ({ name, n })) : null);
    if (unknown > 0) setMessage(`${unknown} رمز لم يُعرف ولم يُسجَّل.`);
  };

  const tapSell = async (r: DayRow) => {
    unlockAudio();
    if (!(await confirmOne(r.product))) return;
    await recordSale(r.product, 1);
    beepOk();
    const fresh = await refresh();
    setLast(fresh.find((x) => x.product.id === r.product.id) ?? null);
    setMessage(null);
    setSession(null);
  };

  /** A staff member undoes a sale only with «رمز المدير»; the owner is not asked. */
  const askManagerPin = () => new Promise<boolean>((resolve) => {
    if (!staff?.manager_pin) {
      void presentPin({
        header: 'رمز المدير',
        message: 'لم يحدّد صاحب المتجر رمز المدير بعد. اطلب منه تحديده من «الموظفون».',
        buttons: [{ text: 'حسناً', handler: () => resolve(false) }],
      });
      return;
    }
    const locked = pinLockedMinutes();
    if (locked > 0) {
      void presentPin({
        header: 'رمز المدير',
        message: `تم إيقاف التراجع مؤقتاً بسبب رموز خاطئة متكررة. حاول بعد ${locked} دقيقة.`,
        buttons: [{ text: 'حسناً', handler: () => resolve(false) }],
      });
      return;
    }
    void presentPin({
      header: 'رمز المدير',
      message: 'التراجع عن البيع يحتاج رمز المدير.',
      inputs: [{ name: 'pin', type: 'password', placeholder: '••••••', attributes: { inputmode: 'numeric', maxlength: PIN_LENGTH } }],
      backdropDismiss: false,
      buttons: [
        { text: 'إلغاء', role: 'cancel', handler: () => resolve(false) },
        {
          text: 'تأكيد',
          handler: (v: { pin?: string }) => {
            void pinMatches(toLatinDigits(v.pin ?? ''), staff.manager_pin).then((ok) => {
              const nowLocked = notePinAttempt(ok);
              if (!ok) {
                setMessage(nowLocked
                  ? 'رمز المدير غير صحيح. تم إيقاف التراجع 5 دقائق.'
                  : 'رمز المدير غير صحيح.');
              }
              resolve(ok);
            });
          },
        },
      ],
    });
  });

  const undo = async () => {
    if (!last) return;
    if (staff && !(await askManagerPin())) return;
    await recordSale(last.product, -1);
    const fresh = await refresh();
    setLast(fresh.find((r) => r.product.id === last.product.id) ?? null);
    setMessage('تم التراجع عن عملية البيع.');
  };

  const term = search.trim().toLowerCase();
  // Only what can be sold: stock left today (daily) or on the shelf (permanent).
  // A sold-out product disappears from the list; a scan can still record it.
  const inStock = rows.filter((r) => r.left > 0);
  const shown = term ? inStock.filter((r) => r.product.name.toLowerCase().includes(term)) : inStock;
  const soldToday = totalsOf(rows).sold;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>بيع</IonTitle>
          <IonButtons slot="end"><RefreshButton busy={pull.busy} onClick={() => { void pull.run(); }} /></IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <PosRefresher onRefresh={pull.run} />
        {cameraScanAvailable() ? (
          <>
            <IonButton expand="block" size="large" onClick={() => { void scan(); }} disabled={busy}>
              {busy ? <IonSpinner name="crescent" /> : <IonIcon slot="start" icon={ICONS.scan} />}
              مسح منتج
            </IonButton>
            <IonItem lines="none">
              <IonToggle checked={continuous} onIonChange={(e) => toggleContinuous(e.detail.checked)}>
                مسح متتابع
              </IonToggle>
            </IonItem>
            <IonItem lines="none">
              <IonToggle checked={sound} onIonChange={(e) => toggleSound(e.detail.checked)}>
                صوت المسح
              </IonToggle>
            </IonItem>
          </>
        ) : (
          <IonItem>
            <IonLabel position="stacked">الرمز (للتجربة في المتصفح)</IonLabel>
            <IonInput
              value={typed} inputmode="numeric" placeholder="2000000000000"
              onIonInput={(e) => setTyped(e.detail.value ?? '')}
              onKeyUp={(e) => {
                if (e.key === 'Enter' && typed.trim()) { void handleTyped(typed); setTyped(''); }
              }}
            />
          </IonItem>
        )}
        {/* Applies to scans AND to tapping a product below. */}
        <IonItem lines="none">
          <IonToggle checked={confirmSale} onIonChange={(e) => toggleConfirm(e.detail.checked)}>
            تأكيد كل بيعة ✓ / ✕
          </IonToggle>
        </IonItem>

        {message && <IonText color="medium"><p className="ion-text-center">{message}</p></IonText>}

        {session && (
          <div className="ion-text-center ion-margin-vertical">
            <b>بعت الآن</b>
            <p style={{ margin: '4px 0' }}>{session.map((s) => `${s.name} ×${s.n}`).join('، ')}</p>
          </div>
        )}

        {last && (
          <div className="ion-text-center ion-margin-top">
            <h1 style={{ margin: 0 }}>{last.product.name}</h1>
            {(seeReports || seeStock) && (
              <p style={{ fontSize: '1.1rem' }}>
                {seeReports && <>مباع اليوم <b>{last.sold}</b></>}
                {seeReports && seeStock && ' · '}
                {seeStock && (
                  <>متبقي <b style={{ color: last.left <= 0 ? 'var(--ion-color-danger)' : undefined }}>{last.left}</b></>
                )}
              </p>
            )}
            {last.product.daily && last.baked === 0 ? (
              <IonText color="warning"><p>لم تُسجَّل كمية مخبوزة لهذا المنتج اليوم.</p></IonText>
            ) : last.left < 0 && (
              <IonText color="warning"><p>المخزون لا يكفي: بعت أكثر من المتوفر.</p></IonText>
            )}
            <IonButton fill="outline" color="medium" onClick={() => { void undo(); }}>
              <IonIcon slot="start" icon={ICONS.undo} />
              تراجع
            </IonButton>
          </div>
        )}
        {seeReports && <p className="ion-text-center" style={{ opacity: .7 }}>إجمالي المباع اليوم: {soldToday}</p>}

        {/* Tap-to-sell: the same sale, no camera. */}
        <IonText color="medium"><p style={{ margin: '16px 4px 0' }}>أو اضغط على المنتج لبيع واحد:</p></IonText>
        <IonSearchbar
          value={search} placeholder="بحث عن منتج"
          onIonInput={(e) => setSearch(e.detail.value ?? '')}
        />
        <IonList>
          {shown.map((r) => (
            <IonItem key={r.product.id} button onClick={() => { void tapSell(r); }}>
              <IonLabel className="ion-text-wrap">
                <h3>{r.product.name}</h3>
                {seeStock && <p>متبقي {r.left}</p>}
              </IonLabel>
                          </IonItem>
          ))}
          {shown.length === 0 && (
            <IonText color="medium">
              <p className="ion-text-center ion-padding">
                {term ? 'لا نتائج.'
                  : staff ? 'لا توجد كميات للبيع. تواصل مع مُدخل الكميات أو المدير.'
                    : 'لا توجد منتجات في المخزون. أضف الكميات من تبويب «اليوم».'}
              </p>
            </IonText>
          )}
        </IonList>
      </IonContent>
      <PosFooter />
    </IonPage>
  );
};

export default SellPage;
