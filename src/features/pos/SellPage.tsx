import { useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton, IonIcon, IonInput,
  IonItem, IonLabel, IonText, IonSpinner,
} from '@ionic/react';
import { cameraOutline, arrowUndoOutline } from 'ionicons/icons';
import PosFooter from './PosFooter';
import { sellByCode, recordSale, getDayRows, totalsOf, type DayRow } from './stock';
import { cameraScanAvailable, scanOne } from './scanner';
import { parseScannedCode } from '../../lib/productCodes';
import { toLatinDigits } from '../../lib/digits';

// «بيع» — scan the product's barcode and ONE sale is recorded. The card shows
// what was just sold and how many of it are left; «تراجع» takes it back with
// an opposite entry.
const SellPage: React.FC = () => {
  const [last, setLast] = useState<DayRow | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [soldToday, setSoldToday] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');

  const handle = async (raw: string) => {
    const out = await sellByCode(toLatinDigits(raw), parseScannedCode);
    if (out.ok) {
      setLast(out.row);
      setMessage(null);
      setSoldToday(totalsOf(await getDayRows()).sold);
    } else {
      setLast(null);
      setMessage(out.reason === 'unknown-code'
        ? 'هذا ليس رمز أحد منتجاتك.'
        : 'الرمز غير مسجل. ربما حُذف المنتج.');
    }
  };

  const scan = async () => {
    setBusy(true);
    try {
      const raw = await scanOne();
      if (raw) await handle(raw);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!last) return;
    await recordSale(last.product, -1);
    const rows = await getDayRows();
    setLast(rows.find((r) => r.product.id === last.product.id) ?? null);
    setSoldToday(totalsOf(rows).sold);
    setMessage('تم التراجع عن عملية البيع.');
  };

  return (
    <IonPage>
      <IonHeader><IonToolbar><IonTitle>بيع</IonTitle></IonToolbar></IonHeader>
      <IonContent className="ion-padding">
        {cameraScanAvailable() ? (
          <IonButton expand="block" size="large" onClick={scan} disabled={busy}>
            {busy ? <IonSpinner name="crescent" /> : <IonIcon slot="start" icon={cameraOutline} />}
            مسح منتج
          </IonButton>
        ) : (
          // A browser has no camera scanner: type (or paste) the 13 digits.
          <IonItem>
            <IonLabel position="stacked">الرمز (للتجربة في المتصفح)</IonLabel>
            <IonInput
              value={typed} inputmode="numeric" placeholder="2000000000000"
              onIonInput={(e) => setTyped(e.detail.value ?? '')}
              onKeyUp={(e) => {
                if (e.key === 'Enter' && typed.trim()) { void handle(typed); setTyped(''); }
              }}
            />
          </IonItem>
        )}

        {message && <IonText color="medium"><p className="ion-text-center">{message}</p></IonText>}

        {last && (
          <div className="ion-text-center ion-margin-top">
            <h1 style={{ margin: 0 }}>{last.product.name}</h1>
            <p style={{ fontSize: '1.1rem' }}>
              مباع اليوم <b>{last.sold}</b> · متبقي <b style={{ color: last.left <= 0 ? 'var(--ion-color-danger)' : undefined }}>{last.left}</b>
            </p>
            {last.baked === 0 && (
              <IonText color="warning"><p>لم تُسجَّل كمية مخبوزة لهذا المنتج اليوم.</p></IonText>
            )}
            <IonButton fill="outline" color="medium" onClick={undo}>
              <IonIcon slot="start" icon={arrowUndoOutline} />
              تراجع
            </IonButton>
          </div>
        )}
        {soldToday !== null && (
          <p className="ion-text-center" style={{ opacity: .7 }}>إجمالي المباع اليوم: {soldToday}</p>
        )}
      </IonContent>
      <PosFooter />
    </IonPage>
  );
};

export default SellPage;
