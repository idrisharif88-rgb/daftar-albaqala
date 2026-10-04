import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IonContent, IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon,
  IonSearchbar, IonSegment, IonSegmentButton, IonLabel, IonRefresher, IonRefresherContent,
  IonSpinner, useIonAlert, useIonToast,
} from '@ionic/react';
import { logOutOutline, refreshOutline } from 'ionicons/icons';
import { Account, ApiError, Status, listAccounts, setAccountStatus } from '../lib/api';
import { useAuth } from '../lib/auth';
import { digitsOnly } from '../lib/digits';

type Filter = 'all' | 'none' | 'active' | 'suspended';

const STATUS_AR: Record<Status, string> = {
  none: 'غير مفعّل',
  active: 'مفعّل',
  expired: 'منتهي',
  suspended: 'موقوف',
};

// 'active' with a past expiry date is refused by the server — show it as
// what it is, not as what the column says.
function effectiveStatus(a: Account): Status {
  if (
    a.subscription_status === 'active' &&
    a.subscription_expires_at &&
    new Date(a.subscription_expires_at).getTime() <= Date.now()
  ) {
    return 'expired';
  }
  return a.subscription_status;
}

// Fixed YYYY-MM-DD with Latin digits, like the shopkeeper app's exports.
function day(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const Accounts: React.FC = () => {
  const { logout } = useAuth();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [presentAlert] = useIonAlert();
  const [presentToast] = useIonToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      setAccounts(await listAccounts());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const c = { all: 0, none: 0, active: 0, suspended: 0 };
    for (const a of accounts ?? []) {
      c.all++;
      const s = effectiveStatus(a);
      if (s === 'none' || s === 'expired') c.none++;
      else c[s]++;
    }
    return c;
  }, [accounts]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = digitsOnly(q);
    return (accounts ?? []).filter((a) => {
      const s = effectiveStatus(a);
      if (filter === 'none' && s !== 'none' && s !== 'expired') return false;
      if (filter === 'active' && s !== 'active') return false;
      if (filter === 'suspended' && s !== 'suspended') return false;
      if (!q) return true;
      return (
        (a.store_name ?? '').toLowerCase().includes(q) ||
        (qDigits !== '' && a.phone.includes(qDigits))
      );
    });
  }, [accounts, query, filter]);

  const change = (a: Account, status: 'active' | 'suspended') => {
    const who = a.store_name || a.phone;
    const activating = status === 'active';
    presentAlert({
      header: activating ? 'تفعيل الحساب' : 'إيقاف الحساب',
      message: activating
        ? `تفعيل «${who}»؟ ستعمل المزامنة لهذا الحساب.`
        : `إيقاف «${who}»؟ لن يستطيع الدخول ولا المزامنة حتى تعيد تفعيله. بياناته تبقى محفوظة.`,
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: activating ? 'تفعيل' : 'إيقاف',
          role: activating ? 'confirm' : 'destructive',
          handler: async () => {
            setBusyId(a.id);
            try {
              await setAccountStatus(a.id, status);
              presentToast({
                message: activating ? 'تم التفعيل' : 'تم الإيقاف',
                duration: 1800,
                color: activating ? 'success' : 'danger',
              });
              await load();
            } catch (err) {
              presentToast({
                message: err instanceof ApiError ? err.message : 'تعذّر التنفيذ',
                duration: 2500,
                color: 'danger',
              });
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    });
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>مراقب البقالة</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => void load()} aria-label="تحديث">
              <IonIcon slot="icon-only" icon={refreshOutline} />
            </IonButton>
            <IonButton onClick={logout} aria-label="خروج">
              <IonIcon slot="icon-only" icon={logOutOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
        <IonToolbar>
          <IonSegment value={filter} onIonChange={(e) => setFilter(e.detail.value as Filter)}>
            <IonSegmentButton value="all"><IonLabel>الكل</IonLabel></IonSegmentButton>
            <IonSegmentButton value="none"><IonLabel>بانتظار التفعيل</IonLabel></IonSegmentButton>
            <IonSegmentButton value="active"><IonLabel>مفعّل</IonLabel></IonSegmentButton>
            <IonSegmentButton value="suspended"><IonLabel>موقوف</IonLabel></IonSegmentButton>
          </IonSegment>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={async (e) => { await load(); e.detail.complete(); }}>
          <IonRefresherContent />
        </IonRefresher>

        <div className="summary">
          <div className="summary__chip"><div className="summary__num">{counts.all}</div><div className="summary__label">كل الحسابات</div></div>
          <div className="summary__chip"><div className="summary__num">{counts.none}</div><div className="summary__label">بانتظار التفعيل</div></div>
          <div className="summary__chip"><div className="summary__num">{counts.active}</div><div className="summary__label">مفعّل</div></div>
          <div className="summary__chip"><div className="summary__num">{counts.suspended}</div><div className="summary__label">موقوف</div></div>
        </div>

        <IonSearchbar
          value={query}
          onIonInput={(e) => setQuery(e.detail.value ?? '')}
          placeholder="بحث بالاسم أو الرقم"
        />

        {error && <div className="empty">{error}</div>}
        {!accounts && !error && <div className="empty"><IonSpinner name="crescent" /></div>}
        {accounts && shown.length === 0 && <div className="empty">لا توجد حسابات</div>}

        {shown.map((a) => {
          const s = effectiveStatus(a);
          return (
            <div key={a.id} className="acct">
              <div className="acct__top">
                <div>
                  <div className="acct__name">{a.store_name || 'بدون اسم'}</div>
                  <div className="acct__phone">{a.phone}</div>
                </div>
                <span className={`badge badge--${s}`}>{STATUS_AR[s]}</span>
              </div>
              <div className="acct__meta">
                جهات: {a.customers_count} · حركات: {a.transactions_count}
                <br />
                التسجيل: <span className="ltr">{day(a.created_at)}</span> · آخر نشاط:{' '}
                <span className="ltr">{day(a.last_activity_at)}</span>
              </div>
              <div className="acct__actions">
                {s !== 'active' && (
                  <IonButton size="small" disabled={busyId === a.id} onClick={() => change(a, 'active')}>
                    {s === 'suspended' ? 'إعادة التفعيل' : 'تفعيل'}
                  </IonButton>
                )}
                {s !== 'suspended' && (
                  <IonButton
                    size="small"
                    fill="outline"
                    color="danger"
                    disabled={busyId === a.id}
                    onClick={() => change(a, 'suspended')}
                  >
                    إيقاف
                  </IonButton>
                )}
              </div>
            </div>
          );
        })}
      </IonContent>
    </IonPage>
  );
};

export default Accounts;
