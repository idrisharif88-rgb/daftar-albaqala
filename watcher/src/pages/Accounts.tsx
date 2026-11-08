import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IonContent, IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon,
  IonSearchbar, IonSegment, IonSegmentButton, IonLabel, IonRefresher, IonRefresherContent,
  IonSpinner, IonModal, IonList, IonListHeader, IonItem, IonNote, useIonAlert, useIonToast, useIonRouter,
} from '@ionic/react';
import { logOutOutline, refreshOutline, ellipsisVertical } from 'ionicons/icons';
import {
  Account, ApiError, Status, listAccounts, setAccountStatus, setContractorStatus, setDriveBackup, setPosAccess,
  deleteAccount, setStoreName, setPassword,
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
  // The account whose «المزيد» sheet is open.
  const [manageId, setManageId] = useState<string | null>(null);
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

  // The point-of-sale section: same gate — confirm, then a fresh code.
  const changePos = (a: Account) => {
    const who = a.store_name || a.phone;
    const enabling = !a.pos_enabled;
    presentAlert({
      header: 'قسم نقطة البيع',
      message: enabling
        ? `تفعيل قسم نقطة البيع لـ«${who}»؟ يظهر له في التطبيق (يحتاج إصداراً يتضمنه).`
        : `إيقاف قسم نقطة البيع لـ«${who}»؟ تبقى بياناته على هاتفه.`,
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: enabling ? 'تفعيل' : 'إيقاف',
          role: enabling ? 'confirm' : 'destructive',
          handler: () => {
            setTimeout(() => {
              void ask('قسم نقطة البيع').then((code) => {
                if (code) {
                  void run(a, () => setPosAccess(a.id, enabling, code),
                    enabling ? 'تم تفعيل نقطة البيع' : 'تم إيقاف نقطة البيع');
                }
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

  // New password for a shopkeeper who forgot his. Shown as plain text so the
  // owner can read it back before sending it to him; checked here (6+) so a
  // short one never spends an authenticator code.
  const changePassword = (a: Account) => {
    const who = a.store_name || a.phone;
    presentAlert({
      header: 'كلمة مرور جديدة',
      cssClass: 'confirm-input',
      message: `كلمة مرور جديدة لـ«${who}».\nستة أحرف على الأقل. هاتفه يبقى مسجّلاً، وتُستعمل عند الدخول التالي.`,
      inputs: [{
        name: 'password', type: 'text', placeholder: 'اكتب كلمة المرور هنا',
        attributes: { autocomplete: 'off', autocapitalize: 'off', spellcheck: false, maxlength: 128 },
      }],
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: 'حفظ',
          handler: (data: { password?: string }) => {
            const pw = String(data?.password ?? '').trim();
            if (pw.length < 6) {
              presentToast({ message: 'كلمة المرور قصيرة — ستة أحرف على الأقل', duration: 2500, color: 'warning' });
              return false; // keep the dialog open
            }
            setTimeout(() => {
              void ask('تغيير كلمة المرور').then((code) => {
                if (code) void run(a, () => setPassword(a.id, pw, code), 'تم تغيير كلمة المرور');
              });
            }, 350);
            return true;
          },
        },
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

  // «المزيد»: everything that is not the day-to-day sync switch, grouped so the
  // list can keep growing — a new permission is one more row, not one more
  // button on every card. State is written on each row (a menu of bare verbs
  // would hide what is on and what is off); the destructive rows come last.
  // The sheet closes BEFORE the action's own confirm dialog opens.
  const managed = accounts?.find((x) => x.id === manageId) ?? null;
  const pick = (fn: (a: Account) => void) => {
    const a = managed;
    setManageId(null);
    if (a) setTimeout(() => fn(a), 350);
  };
  const manageSheet = (
    <IonModal
      isOpen={managed !== null}
      onDidDismiss={() => setManageId(null)}
      initialBreakpoint={0.8}
      breakpoints={[0, 0.8, 1]}
    >
      {managed && (
        <IonContent>
          <IonList lines="full">
            <IonListHeader>{managed.store_name || managed.phone}</IonListHeader>

            <IonListHeader><IonLabel>الصلاحيات</IonLabel></IonListHeader>
            {effectiveStatus(managed) !== 'suspended' && (
              <IonItem button detail onClick={() => pick(changeContractor)}>
                <IonLabel>دفتر المقاول</IonLabel>
                <IonNote slot="end">{managed.contractor_status === 'active' ? 'مفعّل' : 'متوقف'}</IonNote>
              </IonItem>
            )}
            <IonItem button detail onClick={() => pick(changeDrive)}>
              <IonLabel>نسخ Google Drive</IonLabel>
              <IonNote slot="end">{managed.drive_backup ? 'مفعّل' : 'متوقف'}</IonNote>
            </IonItem>
            <IonItem button detail onClick={() => pick(changePos)}>
              <IonLabel>نقطة البيع</IonLabel>
              <IonNote slot="end">{managed.pos_enabled ? 'مفعّل' : 'متوقف'}</IonNote>
            </IonItem>

            <IonListHeader><IonLabel>الحساب</IonLabel></IonListHeader>
            <IonItem button detail onClick={() => pick(rename)}><IonLabel>تغيير الاسم</IonLabel></IonItem>
            <IonItem button detail onClick={() => pick(changePassword)}><IonLabel>كلمة المرور</IonLabel></IonItem>

            <IonListHeader><IonLabel>منطقة الخطر</IonLabel></IonListHeader>
            {effectiveStatus(managed) !== 'suspended' && (
              <IonItem button detail={false} onClick={() => pick((a) => change(a, 'suspended'))}>
                <IonLabel color="danger">إيقاف الحساب (منع الدخول)</IonLabel>
              </IonItem>
            )}
            <IonItem button detail={false} onClick={() => pick(remove)}>
              <IonLabel color="danger">حذف الحساب نهائياً</IonLabel>
            </IonItem>
          </IonList>
        </IonContent>
      )}
    </IonModal>
  );

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
                    <span className="badge badge--contractor">المقاول</span>
                  )}
                  {a.pos_enabled && <span className="badge badge--contractor">نقطة البيع</span>}
                  {a.drive_backup && <span className="badge badge--contractor">Drive</span>}
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
                <IonButton size="small" fill="outline" onClick={() => setManageId(a.id)}>
                  <IonIcon slot="start" icon={ellipsisVertical} />
                  المزيد
                </IonButton>
              </div>
            </div>
          );
        })}
      </IonContent>
      {manageSheet}
      {modal}
    </IonPage>
  );
};

export default Accounts;
