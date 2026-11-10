import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  IonContent, IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonList, IonItem,
  IonLabel, IonText, IonSpinner, IonSegment, IonSegmentButton, IonSelect, IonSelectOption, IonListHeader, IonNote,
} from '@ionic/react';
import { ApiError, listShopStaff, shopStaffReport, type ShopStaff, type StaffReport } from '../lib/api';
import { money } from '../lib/format';

// «تقارير الموظفين» — the developer's view of one shop's staff: when each
// member signed in and out, and what they sold per day. Always available to
// the developer; the shop owner sees the same only with «تقرير الموظفين» on.

type Period = 'today' | 'yesterday' | 'week' | 'month';
const LABELS: Record<Period, string> = { today: 'اليوم', yesterday: 'أمس', week: '7 أيام', month: 'هذا الشهر' };

const day = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
function range(p: Period): { from: string; to: string } {
  const now = new Date();
  const back = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); return day(d); };
  switch (p) {
    case 'today': return { from: day(now), to: day(now) };
    case 'yesterday': return { from: back(1), to: back(1) };
    case 'week': return { from: back(6), to: day(now) };
    case 'month': return { from: day(new Date(now.getFullYear(), now.getMonth(), 1)), to: day(now) };
  }
}
const instant = (s: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

interface Row { day: string; sessions: { in: Date; out: Date | null }[]; qty: number; amount: number }
function byDay(r: StaffReport, from: string, to: string): Row[] {
  const m = new Map<string, Row>();
  const get = (k: string) => { let x = m.get(k); if (!x) { x = { day: k, sessions: [], qty: 0, amount: 0 }; m.set(k, x); } return x; };
  for (const s of r.sessions) {
    const at = instant(s.login_at); const k = day(at);
    if (k >= from && k <= to) get(k).sessions.push({ in: at, out: s.logout_at ? instant(s.logout_at) : null });
  }
  for (const d of r.days) { const x = get(d.day); x.qty = d.qty; x.amount = d.amount; }
  return [...m.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

const StaffReports: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [staff, setStaff] = useState<ShopStaff[] | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('today');
  const [report, setReport] = useState<StaffReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    listShopStaff(id).then((r) => {
      setStaff(r.staff);
      if (r.staff[0]) setStaffId(r.staff[0].id);
    }).catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'تعذّر التحميل'));
  }, [id]);

  const load = useCallback(async () => {
    if (!staffId) return;
    setLoading(true); setError(null);
    try {
      const { from, to } = range(period);
      setReport(await shopStaffReport(id, staffId, from, to));
    } catch (err) {
      setReport(null);
      setError(err instanceof ApiError ? err.message : 'تعذّر التحميل');
    } finally { setLoading(false); }
  }, [id, staffId, period]);
  useEffect(() => { void load(); }, [load]);

  const { from, to } = range(period);
  const rows = report ? byDay(report, from, to) : [];

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/accounts" text="رجوع" /></IonButtons>
          <IonTitle>تقارير الموظفين</IonTitle>
        </IonToolbar>
        <IonToolbar>
          <IonSegment value={period} onIonChange={(e) => setPeriod(e.detail.value as Period)}>
            {(Object.keys(LABELS) as Period[]).map((p) => (
              <IonSegmentButton key={p} value={p}><IonLabel>{LABELS[p]}</IonLabel></IonSegmentButton>
            ))}
          </IonSegment>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {staff === null && !error ? (
          <div className="ion-text-center ion-padding"><IonSpinner name="crescent" /></div>
        ) : staff && staff.length === 0 ? (
          <IonText color="medium"><p className="ion-text-center ion-padding">لا يوجد موظفون في هذا المتجر.</p></IonText>
        ) : (
          <>
            {staff && (
              <IonItem>
                <IonSelect label="الموظف" interface="popover" value={staffId} onIonChange={(e) => setStaffId(String(e.detail.value))}>
                  {staff.map((s) => (
                    <IonSelectOption key={s.id} value={s.id}>{s.name}{s.disabled ? ' (موقوف)' : ''}</IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>
            )}
            {loading ? (
              <div className="ion-text-center ion-padding"><IonSpinner name="crescent" /></div>
            ) : error ? (
              <IonText color="danger"><p className="ion-text-center ion-padding">{error}</p></IonText>
            ) : report && (
              <>
                <IonItem lines="none">
                  <IonLabel>
                    <h2 style={{ fontWeight: 700 }}>المبيعات: {money(report.totals.amount / 100, 'YER')}</h2>
                    <p>عدد القطع: {report.totals.qty}</p>
                  </IonLabel>
                </IonItem>
                {rows.length === 0 ? (
                  <IonText color="medium"><p className="ion-text-center ion-padding">لا دخول ولا مبيعات في هذه الفترة.</p></IonText>
                ) : rows.map((r) => (
                  <IonList key={r.day}>
                    <IonListHeader><IonLabel dir="ltr" style={{ textAlign: 'right' }}>{r.day}</IonLabel></IonListHeader>
                    {r.sessions.length === 0 ? (
                      <IonItem lines="none"><IonNote>لا يوجد تسجيل دخول في هذا اليوم.</IonNote></IonItem>
                    ) : r.sessions.map((s, i) => (
                      <IonItem key={i} lines="none">
                        <IonLabel>
                          دخول <span dir="ltr">{hhmm(s.in)}</span>{' · '}
                          {s.out
                            ? <>خروج <span dir="ltr">{day(s.out) === r.day ? hhmm(s.out) : `${day(s.out)} ${hhmm(s.out)}`}</span></>
                            : <IonText color="warning">لم يخرج</IonText>}
                        </IonLabel>
                      </IonItem>
                    ))}
                    <IonItem>
                      <IonLabel>باع {r.qty} قطعة</IonLabel>
                      <IonText slot="end" style={{ fontWeight: 700 }}>{money(r.amount / 100, 'YER')}</IonText>
                    </IonItem>
                  </IonList>
                ))}
              </>
            )}
          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default StaffReports;
