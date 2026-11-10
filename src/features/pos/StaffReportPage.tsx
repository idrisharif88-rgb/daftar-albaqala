import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Redirect } from 'react-router-dom';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonBackButton, IonList, IonItem,
  IonLabel, IonText, IonSpinner, IonSegment, IonSegmentButton, IonListHeader, IonNote,
  useIonViewWillEnter,
} from '@ionic/react';
import PosFooter from './PosFooter';
import { useAuth } from '../../lib/auth';
import { ApiError, staffReport, type StaffReport } from '../../lib/api';
import { formatMinor } from '../../data/money';
import { localDay } from './day';

// «تقرير الموظف» — the OWNER's report on one staff member: when they signed in
// and out, and what they sold, day by day. Owner only (the server refuses
// anyone else, even a member managing staff). Online: it is read from the
// server, which is where each sale was stamped with its seller.
//
// Sales made before the report existed carry no seller and appear nowhere.

type Period = 'today' | 'yesterday' | 'week' | 'month';
const PERIOD_LABELS: Record<Period, string> = {
  today: 'اليوم', yesterday: 'أمس', week: '7 أيام', month: 'هذا الشهر',
};

function range(p: Period): { from: string; to: string } {
  const now = new Date();
  const back = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); return localDay(d); };
  switch (p) {
    case 'today': return { from: localDay(now), to: localDay(now) };
    case 'yesterday': return { from: back(1), to: back(1) };
    case 'week': return { from: back(6), to: localDay(now) };
    case 'month': return { from: localDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: localDay(now) };
  }
}

/** The server's DATETIME, read as UTC. */
function instant(s: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
}
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

interface DayRow {
  day: string;
  sessions: { in: Date; out: Date | null }[];
  qty: number;
  amount: number;
}

function byDay(r: StaffReport, from: string, to: string): DayRow[] {
  const rows = new Map<string, DayRow>();
  const get = (day: string) => {
    let row = rows.get(day);
    if (!row) { row = { day, sessions: [], qty: 0, amount: 0 }; rows.set(day, row); }
    return row;
  };
  for (const s of r.sessions) {
    const at = instant(s.login_at);
    const day = localDay(at);
    if (day < from || day > to) continue;
    get(day).sessions.push({ in: at, out: s.logout_at ? instant(s.logout_at) : null });
  }
  for (const d of r.days) { const row = get(d.day); row.qty = d.qty; row.amount = d.amount; }
  return [...rows.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

const StaffReportPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { staff } = useAuth();
  const [period, setPeriod] = useState<Period>('today');
  const [report, setReport] = useState<StaffReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const { from, to } = range(p);
      setReport(await staffReport(id, from, to));
    } catch (err) {
      setReport(null);
      setError(err instanceof ApiError && err.status === 0 ? 'لا يوجد اتصال بالإنترنت.'
        : err instanceof ApiError && err.status === 404 ? 'الموظف غير موجود.'
          : err instanceof ApiError && err.status === 403 ? 'التقرير غير مفعّل لهذا المتجر.'
          : 'تعذّر تحميل التقرير.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useIonViewWillEnter(() => { void load(period); });

  if (staff) return <Redirect to="/pos/account" />; // owner only

  const { from, to } = range(period);
  const rows = report ? byDay(report, from, to) : [];

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/pos/staff" text="رجوع" /></IonButtons>
          <IonTitle>تقرير {report?.staff.name ?? ''}</IonTitle>
        </IonToolbar>
        <IonToolbar>
          <IonSegment value={period} onIonChange={(e) => {
            const p = e.detail.value as Period;
            setPeriod(p);
            void load(p);
          }}>
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
              <IonSegmentButton key={p} value={p}><IonLabel>{PERIOD_LABELS[p]}</IonLabel></IonSegmentButton>
            ))}
          </IonSegment>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {loading ? (
          <div className="ion-text-center ion-padding"><IonSpinner name="crescent" /></div>
        ) : error ? (
          <IonText color="danger"><p className="ion-text-center ion-padding">{error}</p></IonText>
        ) : report && (
          <>
            <div className="balance-card">
              <div className="balance-card__label">المبيعات · {PERIOD_LABELS[period]}</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{formatMinor(report.totals.amount)} ريال</div>
              <div className="balance-card__label">عدد القطع: {report.totals.qty}</div>
            </div>
            {rows.length === 0 ? (
              <IonText color="medium">
                <p className="ion-text-center ion-padding">لا دخول ولا مبيعات في هذه الفترة.</p>
              </IonText>
            ) : rows.map((r) => (
              <IonList key={r.day}>
                <IonListHeader><IonLabel dir="ltr" style={{ textAlign: 'right' }}>{r.day}</IonLabel></IonListHeader>
                {r.sessions.length === 0 ? (
                  <IonItem lines="none"><IonNote>لا يوجد تسجيل دخول في هذا اليوم.</IonNote></IonItem>
                ) : r.sessions.map((s, i) => (
                  <IonItem key={i} lines="none">
                    <IonLabel>
                      دخول <span dir="ltr">{hhmm(s.in)}</span>
                      {' · '}
                      {s.out
                        ? <>خروج <span dir="ltr">{localDay(s.out) === r.day ? hhmm(s.out) : `${localDay(s.out)} ${hhmm(s.out)}`}</span></>
                        : <IonText color="warning">لم يخرج</IonText>}
                    </IonLabel>
                  </IonItem>
                ))}
                <IonItem>
                  <IonLabel>باع {r.qty} قطعة</IonLabel>
                  <IonText slot="end" style={{ fontWeight: 700 }}>{formatMinor(r.amount)} ريال</IonText>
                </IonItem>
              </IonList>
            ))}
          </>
        )}
      </IonContent>
      <PosFooter />
    </IonPage>
  );
};

export default StaffReportPage;
