import { useCallback, useRef, useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonList, IonItem, IonLabel,
  IonText, IonSpinner, IonModal, IonButtons, IonButton, IonIcon, useIonViewWillEnter, useIonAlert,
} from '@ionic/react';
import { IonBadge } from '@ionic/react';
import PosFooter from './PosFooter';
import { shareDayReport } from './reportPdf';
import { shareSocialOutline } from 'ionicons/icons';
import { getDayRows, listDays, totalsOf, type DayRow, type DaySummary } from './stock';
import { formatMinor } from '../../data/money';

// «السجل» — every past day, newest first. Tap a day to see each product's
// baked, sold and left on that day. Read-only: the days are a record.
const HistoryPage: React.FC = () => {
  const [days, setDays] = useState<DaySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<{ day: string; rows: DayRow[] } | null>(null);
  const modal = useRef<HTMLIonModalElement>(null);
  const [presentAlert] = useIonAlert();
  const [sharing, setSharing] = useState(false);
  const share = async () => {
    if (!open) return;
    setSharing(true);
    try { await shareDayReport(open.day); }
    catch (err) {
      presentAlert({ header: 'تعذّرت المشاركة', message: err instanceof Error ? err.message : 'حدث خطأ غير متوقع', buttons: ['حسناً'] });
    } finally { setSharing(false); }
  };

  const load = useCallback(async () => {
    setDays(await listDays());
    setLoading(false);
  }, []);
  useIonViewWillEnter(() => { void load(); });

  const openDay = async (day: string) => {
    const rows = (await getDayRows(day)).filter((r) => r.baked !== 0 || r.sold !== 0);
    setOpen({ day, rows });
    void modal.current?.present();
  };

  const t = open ? totalsOf(open.rows) : null;
  return (
    <IonPage>
      <IonHeader><IonToolbar><IonTitle>السجل</IonTitle></IonToolbar></IonHeader>
      <IonContent>
        {loading ? (
          <div className="ion-text-center ion-padding"><IonSpinner name="crescent" /></div>
        ) : days.length === 0 ? (
          <IonText color="medium">
            <p className="ion-text-center ion-padding">لا توجد أيام محفوظة بعد.</p>
          </IonText>
        ) : (
          <IonList>
            {days.map((d) => (
              <IonItem key={d.day} button onClick={() => { void openDay(d.day); }}>
                <IonLabel>
                  <h2 dir="ltr" style={{ textAlign: 'right' }}>{d.day}</h2>
                  <p>
                    مخبوز {d.baked} · مباع {d.sold}{' '}
                    {d.locked && <IonBadge color="success">معتمد</IonBadge>}{' '}
                    {d.reopened > 0 && <IonBadge color="warning">عُدِّل بعد الاعتماد ×{d.reopened}</IonBadge>}
                  </p>
                </IonLabel>
                <IonText slot="end"><strong>{formatMinor(d.revenue)}</strong></IonText>
              </IonItem>
            ))}
          </IonList>
        )}

        <IonModal ref={modal}>
          <IonHeader>
            <IonToolbar>
              <IonTitle><span dir="ltr">{open?.day}</span></IonTitle>
              <IonButtons slot="end">
                <IonButton disabled={sharing} onClick={() => { void share(); }}>
                  <IonIcon slot="start" icon={shareSocialOutline} />
                  مشاركة
                </IonButton>
                <IonButton onClick={() => modal.current?.dismiss()}>إغلاق</IonButton>
              </IonButtons>
            </IonToolbar>
            {t && (
              <IonToolbar>
                <div style={{ display: 'flex', justifyContent: 'space-around', padding: '4px 8px', fontSize: '.9rem' }}>
                  <span>مخبوز <b>{t.baked}</b></span>
                  <span>مباع <b>{t.sold}</b></span>
                  <span>متبقي <b>{t.left}</b></span>
                  <span>الإيراد <b>{formatMinor(t.revenue)}</b></span>
                </div>
              </IonToolbar>
            )}
          </IonHeader>
          <IonContent>
            <IonList>
              {open?.rows.map((r) => (
                <IonItem key={r.product.id}>
                  <IonLabel className="ion-text-wrap">
                    <h2>{r.product.name}</h2>
                    <p>مخبوز {r.baked} · مباع {r.sold} · متبقي {r.left}</p>
                  </IonLabel>
                  <IonText slot="end"><strong>{formatMinor(r.revenue)}</strong></IonText>
                </IonItem>
              ))}
            </IonList>
          </IonContent>
        </IonModal>
      </IonContent>
      <PosFooter />
    </IonPage>
  );
};

export default HistoryPage;
