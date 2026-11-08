import { useCallback, useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton, IonIcon, IonInput,
  IonItem, IonLabel, IonText, IonSpinner, IonToggle, IonSearchbar, IonList, IonBadge,
  useIonViewWillEnter,
} from '@ionic/react';
import { ICONS } from './icons';
import PosFooter from './PosFooter';
import { sellByCode, recordSale, getDayRows, totalsOf, type DayRow } from './stock';
import { cameraScanAvailable, scanOne } from './scanner';
import { beepBad, beepOk, setSoundEnabled, soundEnabled, unlockAudio } from './beep';
import { parseScannedCode } from '../../lib/productCodes';
import { toLatinDigits } from '../../lib/digits';

// «بيع» — sell by scanning the product's barcode, or by tapping its name.
//
//  • One scan = ONE sale. With «مسح متتابع» on, the camera reopens by itself
//    after every scan, so a queue of customers is item, item, item — he taps
//    back when done and sees what was sold.
//  • Tapping a name does the same sale with no camera, for a torn or smudged
//    label.
// «تراجع» takes back the last sale with an opposite entry.

const CONT_KEY = 'daftar.pos.continuous';
const readContinuous = (): boolean => {
  try { return localStorage.getItem(CONT_KEY) !== '0'; } catch { return true; }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SellPage: React.FC = () => {
  const [rows, setRows] = useState<DayRow[]>([]);
  const [last, setLast] = useState<DayRow | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [session, setSession] = useState<{ name: string; n: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [continuous, setContinuous] = useState<boolean>(readContinuous);
  const [sound, setSound] = useState<boolean>(soundEnabled);

  const refresh = useCallback(async (): Promise<DayRow[]> => {
    const r = await getDayRows();
    setRows(r);
    return r;
  }, []);
  useIonViewWillEnter(() => { void refresh(); });

  const toggleSound = (on: boolean) => {
    setSound(on);
    setSoundEnabled(on);
    if (on) { unlockAudio(); beepOk(); } // let him hear what he just switched on
  };

  const toggleContinuous = (on: boolean) => {
    setContinuous(on);
    try { localStorage.setItem(CONT_KEY, on ? '1' : '0'); } catch { /* a convenience only */ }
  };

  // The browser has no camera scanner: a typed or pasted code stands in.
  const handleTyped = async (raw: string) => {
    unlockAudio();
    const out = await sellByCode(toLatinDigits(raw), parseScannedCode);
    if (out.ok) { beepOk(); setLast(out.row); setMessage(null); setSession(null); await refresh(); }
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
        const out = await sellByCode(toLatinDigits(raw), parseScannedCode);
        if (out.ok) {
          beepOk();
          counts.set(out.row.product.name, (counts.get(out.row.product.name) ?? 0) + 1);
          lastRow = out.row;
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
    await recordSale(r.product, 1);
    beepOk();
    const fresh = await refresh();
    setLast(fresh.find((x) => x.product.id === r.product.id) ?? null);
    setMessage(null);
    setSession(null);
  };

  const undo = async () => {
    if (!last) return;
    await recordSale(last.product, -1);
    const fresh = await refresh();
    setLast(fresh.find((r) => r.product.id === last.product.id) ?? null);
    setMessage('تم التراجع عن عملية البيع.');
  };

  const term = search.trim().toLowerCase();
  const shown = term ? rows.filter((r) => r.product.name.toLowerCase().includes(term)) : rows;
  const soldToday = totalsOf(rows).sold;

  return (
    <IonPage>
      <IonHeader><IonToolbar><IonTitle>بيع</IonTitle></IonToolbar></IonHeader>
      <IonContent className="ion-padding">
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
            <p style={{ fontSize: '1.1rem' }}>
              مباع اليوم <b>{last.sold}</b> · متبقي{' '}
              <b style={{ color: last.left <= 0 ? 'var(--ion-color-danger)' : undefined }}>{last.left}</b>
            </p>
            {last.baked === 0 && (
              <IonText color="warning"><p>لم تُسجَّل كمية مخبوزة لهذا المنتج اليوم.</p></IonText>
            )}
            <IonButton fill="outline" color="medium" onClick={() => { void undo(); }}>
              <IonIcon slot="start" icon={ICONS.undo} />
              تراجع
            </IonButton>
          </div>
        )}
        <p className="ion-text-center" style={{ opacity: .7 }}>إجمالي المباع اليوم: {soldToday}</p>

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
                <p>مباع {r.sold} · متبقي {r.left}</p>
              </IonLabel>
              {r.baked > 0 && r.left <= 0 && <IonBadge slot="end" color="danger">نفد</IonBadge>}
            </IonItem>
          ))}
        </IonList>
      </IonContent>
      <PosFooter />
    </IonPage>
  );
};

export default SellPage;
