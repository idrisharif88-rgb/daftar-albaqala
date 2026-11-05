import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IonContent, IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon,
  IonSearchbar, IonSegment, IonSegmentButton, IonLabel, IonRefresher, IonRefresherContent,
  IonSpinner, useIonAlert, useIonToast, useIonRouter,
} from '@ionic/react';
import { logOutOutline, refreshOutline } from 'ionicons/icons';
import {
  Account, ApiError, Status, listAccounts, setAccountStatus, setContractorStatus, setDriveBackup,
  deleteAccount, setStoreName,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { digitsOnly } from '../lib/digits';
import { useAdminCode } from '../lib/useAdminCode';

type Filter = 'all' | 'none' | 'active' | 'suspended';

const STATUS_AR: Record<Status, string> = {
  none: 'بدون مزامنة',
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
  // A second alert hook: rename asks "which book?" and then for the name, and
  // one hook keeps only one overlay at a time.
  const [presentAlert2] = useIonAlert();
  const [presentToast] = useIonToast();
  const router = useIonRouter();
  const { ask, modal } = useAdminCode();

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

  const doChange = async (a: Account, status: 'active' | 'none' | 'suspended', code: string) => {
    const activating = status === 'active';
    setBusyId(a.id);
    try {
      await setAccountStatus(a.id, status, code);
      presentToast({
        message: activating ? 'تم التفعيل' : status === 'none' ? 'تم إيقاف المزامنة' : 'تم الإيقاف',
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
  };

  // «دفتر المقاول» is activated on its own — one login, two apps, two
  // activations. Same gate as every other change: confirm, then a fresh code.
  const doContractor = async (a: Account, active: boolean, code: string) => {
    setBusyId(a.id);
    try {
      await setContractorStatus(a.id, active, code);
      presentToast({
        message: active ? 'تم تفعيل دفتر المقاول' : 'تم إلغاء تفعيل دفتر المقاول',
        duration: 1800,
        color: active ? 'success' : 'medium',
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
  };

  const changeContractor = (a: Account) => {
    const who = a.store_name || a.phone;
    const activating = a.contractor_status !== 'active';
    presentAlert({
      header: 'دفتر المقاول',
      message: activating
        ? `تفعيل «دفتر المقاول» لـ«${who}»؟ تعمل مزامنته، ودفتر البقالة يبقى كما هو.`
        : `إلغاء تفعيل «دفتر المقاول» لـ«${who}»؟ تتوقف مزامنته فقط. بياناته تبقى محفوظة.`,
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: activating ? 'تفعيل' : 'إلغاء التفعيل',
          role: activating ? 'confirm' : 'destructive',
          handler: () => {
            setTimeout(() => {
              void ask('دفتر المقاول').then((code) => {
                if (code) void doContractor(a, activating, code);
              });
            }, 350);
          },
        },
      ],
    });
  };

  // Google Drive backup: an extra granted per account. Same gate as every other
  // change — confirm, then a fresh authenticator code.
  const doDrive = async (a: Account, enabled: boolean, code: string) => {
    setBusyId(a.id);
    try {
      await setDriveBackup(a.id, enabled, code);
      presentToast({
        message: enabled ? 'تم تفعيل نسخ Google Drive' : 'تم إيقاف نسخ Google Drive',
        duration: 1800,
        color: enabled ? 'success' : 'medium',
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
  };

  const changeDrive = (a: Account) => {
    const who = a.store_name || a.phone;
    const enabling = !a.drive_backup;
    presentAlert({
      header: 'نسخ Google Drive',
      message: enabling
        ? `السماح لـ«${who}» بحفظ نسخة من دفتره في Google Drive الخاص به؟`
        : `إيقاف نسخ Google Drive لـ«${who}»؟ نسخه السابقة تبقى في حسابه على Google.`,
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: enabling ? 'سماح' : 'إيقاف',
          role: enabling ? 'confirm' : 'destructive',
          handler: () => {
            setTimeout(() => {
              void ask('نسخ Google Drive').then((code) => {
                if (code) void doDrive(a, enabling, code);
              });
            }, 350);
          },
        },
      ],
    });
  };

  // One runner for the two new changes: busy flag, toast, reload.
  const run = async (a: Account, act: () => Promise<unknown>, done: string) => {
    setBusyId(a.id);
    try {
      await act();
      presentToast({ message: done, duration: 1800, color: 'success' });
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
  };

  // Rename a store. An account using both apps has two names, so it asks which.
  const askName = (a: Account, app: 'grocery' | 'contractor') => {
    const current = (app === 'contractor' ? a.contractor_store_name : a.store_name) ?? '';
    presentAlert2({
      header: app === 'contractor' ? 'اسم المقاول' : 'اسم المتجر',
      message: 'يظهر الاسم الجديد على هاتفه بعد المزامنة التالية.',
      inputs: [{ name: 'name', type: 'text', value: current, placeholder: 'الاسم', attributes: { maxlength: 100 } }],
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: 'حفظ',
          handler: (data: { name?: string }) => {
            const name = String(data?.name ?? '').trim();
            if (name === current.trim()) return;
            setTimeout(() => {
              void ask('تغيير الاسم').then((code) => {
                if (code) void run(a, () => setStoreName(a.id, name, app, code), 'تم تغيير الاسم');
              });
            }, 350);
          },
        },
      ],
    });
  };

  const rename = (a: Account) => {
    if (a.contractor_status !== 'active' && !a.contractor_store_name) { askName(a, 'grocery'); return; }
    presentAlert({
      header: 'تغيير الاسم',
      message: 'أي دفتر؟',
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        { text: 'البقالة', handler: () => { setTimeout(() => askName(a, 'grocery'), 350); } },
        { text: 'المقاول', handler: () => { setTimeout(() => askName(a, 'contractor'), 350); } },
      ],
    });
  };

  // Erase a whole account — cannot be undone. The owner types the account's
  // number back; the server checks it too.
  const remove = (a: Account) => {
    const who = a.store_name || a.phone;
    presentAlert({
      header: 'حذف الحساب نهائياً',
      cssClass: 'confirm-delete',
      // One fact per line (the alert keeps line breaks — see .confirm-delete).
      message: `سيُحذف «${who}» مع ${a.customers_count} جهة و${a.transactions_count} حركة من الخادم، ولا يمكن التراجع.\n\n` +
        `للتأكيد، اكتب رقم الحساب:\n${a.phone}`,
      inputs: [{
        name: 'phone', type: 'tel', placeholder: 'اكتب الرقم هنا',
        attributes: { inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'رقم الحساب للتأكيد' },
      }],
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: 'حذف',
          role: 'destructive',
          handler: (data: { phone?: string }) => {
            // Same number however it was typed: Arabic digits, spaces, or with
            // the country code / a leading zero (00967…, 967…, 0…).
            const local = (v: string) => digitsOnly(v).replace(/^(00)?967/, '').replace(/^0+/, '');
            if (!local(String(data?.phone ?? '')) || local(String(data?.phone ?? '')) !== local(a.phone)) {
              presentToast({ message: 'الرقم غير مطابق — لم يُحذف شيء', duration: 2500, color: 'warning' });
              return;
            }
            setTimeout(() => {
              void ask('حذف الحساب').then((code) => {
                if (code) void run(a, () => deleteAccount(a.id, a.phone, code), 'تم حذف الحساب');
              });
            }, 350);
          },
        },
      ],
    });
  };

  // Sync off: the account keeps working on the phone (and its Drive backup);
  // only the server copy stops. Not a lock-out — that is «إيقاف».
  const syncOff = (a: Account) => {
    const who = a.store_name || a.phone;
    presentAlert({
      header: 'إيقاف المزامنة',
      message: `إيقاف المزامنة مع الخادم لـ«${who}»؟ يبقى التطبيق يعمل على هاتفه مع نسخ Google Drive. ` +
        'ما هو على الخادم يبقى محفوظاً، والجديد لا يصل إليه حتى تعيد التفعيل.',
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: 'إيقاف المزامنة',
          role: 'destructive',
          handler: () => {
            setTimeout(() => {
              void ask('إيقاف المزامنة').then((code) => { if (code) void doChange(a, 'none', code); });
            }, 350);
          },
        },
      ],
    });
  };

  const change = (a: Account, status: 'active' | 'suspended') => {
    const who = a.store_name || a.phone;
    const activating = status === 'active';
    presentAlert({
      header: activating ? 'تفعيل الحساب' : 'إيقاف الحساب',
      message: activating
        ? `تفعيل المزامنة لـ«${who}»؟ يُرفع دفتره إلى الخادم.`
        : `إيقاف «${who}»؟ لن يستطيع الدخول ولا المزامنة حتى تعيد تفعيله. بياناته تبقى محفوظة.`,
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: activating ? 'تفعيل' : 'إيقاف',
          role: activating ? 'confirm' : 'destructive',
          handler: () => {
            // Let the confirm alert finish dismissing before the code modal opens.
            setTimeout(() => {
              void ask(activating ? 'تفعيل الحساب' : 'إيقاف الحساب').then((code) => {
                if (code) void doChange(a, status, code);
              });
            }, 350);
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
                  {a.contractor_store_name && <div className="acct__phone">المقاول: {a.contractor_store_name}</div>}
                  <div className="acct__phone">{a.phone}</div>
                </div>
                <div className="acct__badges">
                  <span className={`badge badge--${s}`}>{STATUS_AR[s]}</span>
                  {a.contractor_status === 'active' && s !== 'suspended' && (
                    <span className="badge badge--contractor">المقاول مفعّل</span>
                  )}
                </div>
              </div>
              <div className="acct__meta">
                جهات: {a.customers_count} · حركات: {a.transactions_count}
                <br />
                التسجيل: <span className="ltr">{day(a.created_at)}</span> · آخر نشاط:{' '}
                <span className="ltr">{day(a.last_activity_at)}</span>
              </div>
              <div className="acct__actions">
                <IonButton size="small" fill="outline" onClick={() => router.push(`/accounts/${a.id}`)}>
                  فتح الدفتر
                </IonButton>
                {s !== 'active' && (
                  <IonButton size="small" disabled={busyId === a.id} onClick={() => change(a, 'active')}>
                    {s === 'suspended' ? 'إعادة التفعيل' : 'تفعيل المزامنة'}
                  </IonButton>
                )}
                {s === 'active' && (
                  <IonButton size="small" fill="outline" disabled={busyId === a.id} onClick={() => syncOff(a)}>
                    إيقاف المزامنة
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
                {s !== 'suspended' && (
                  <IonButton
                    size="small"
                    fill={a.contractor_status === 'active' ? 'solid' : 'outline'}
                    disabled={busyId === a.id}
                    onClick={() => changeContractor(a)}
                  >
                    {a.contractor_status === 'active' ? 'المقاول: مفعّل' : 'تفعيل المقاول'}
                  </IonButton>
                )}
                <IonButton
                  size="small"
                  fill={a.drive_backup ? 'solid' : 'outline'}
                  disabled={busyId === a.id}
                  onClick={() => changeDrive(a)}
                >
                  {a.drive_backup ? 'Drive: مفعّل' : 'Drive'}
                </IonButton>
                <IonButton size="small" fill="outline" disabled={busyId === a.id} onClick={() => rename(a)}>
                  تغيير الاسم
                </IonButton>
                <IonButton size="small" fill="clear" color="danger" disabled={busyId === a.id} onClick={() => remove(a)}>
                  حذف الحساب
                </IonButton>
              </div>
            </div>
          );
        })}
      </IonContent>
      {modal}
    </IonPage>
  );
};

export default Accounts;
