import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IonContent, IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon,
  IonSearchbar, IonSegment, IonSegmentButton, IonLabel, IonRefresher, IonRefresherContent,
  IonSpinner, IonModal, IonList, IonListHeader, IonItem, IonNote, useIonAlert, useIonToast, useIonRouter,
} from '@ionic/react';
import {
  logOutOutline, refreshOutline, ellipsisVertical, checkmarkCircle, banOutline, shieldOutline, ellipseOutline,
} from 'ionicons/icons';
import {
  Account, ApiError, Status, listAccounts, setAccountStatus, setContractorStatus, setDriveBackup, setPosAccess, setPosStaffAccess, setPosNotesAccess, setPosReportAccess, requestSync, setMultiDevice,
  deleteAccount, setStoreName, setPassword, issueVerificationCode, VerificationCode, setActivation, setLogo, setAccountType,
} from '../lib/api';
import VerificationModal from '../components/VerificationModal';
import LogoModal, { type BrandKind } from '../components/LogoModal';
import FeatureIcons from '../components/FeatureIcons';
import { openLive } from '../lib/live';
import { useAuth } from '../lib/auth';
import { digitsOnly } from '../lib/digits';
import { dateTime } from '../lib/format';
import { useAdminCode } from '../lib/useAdminCode';

type Filter = 'all' | 'active' | 'inactive' | 'suspended';

// What the owner sees first, and what the card's main button does:
//   activated = he approved the account (verified number first) — 023
//   inactive  = new, not approved yet (the app still works on its phone)
//   suspended = locked out of the app
// Server sync is separate (in «المزيد») and needs «activated».
type CardState = 'activated' | 'inactive' | 'suspended';
const CARD_AR: Record<CardState, string> = { activated: 'مفعّل', inactive: 'غير مفعّل', suspended: 'موقوف' };
function cardState(a: Account): CardState {
  if (a.subscription_status === 'suspended') return 'suspended';
  return a.activated === false ? 'inactive' : 'activated';
}

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

/** The server's refusals the owner can act on, in Arabic. */
function arabicAdminError(err: ApiError): string {
  if (err.message.includes('not agreed')) return 'لم يوافق المستخدم على المزامنة بعد. أرسل له طلباً.';
  if (err.message.includes('not verified')) return '🛡️ الرقم غير متحقق';
  if (err.message.includes('not activated')) return 'فعّل الحساب أولاً';
  return err.message;
}

/** What the sync row says, with the user's answer when sync is off. */
function syncNote(a: Account): string {
  if (a.subscription_status === 'active') return 'مفعّلة';
  switch (a.sync_consent) {
    case 'approved': return 'وافق ✓ — فعّل';
    case 'pending': return 'بانتظار الرد';
    case 'rejected': return 'رفض ✗';
    default: return 'إرسال طلب';
  }
}
function syncNoteColor(a: Account): string | undefined {
  if (a.subscription_status === 'active') return undefined;
  if (a.sync_consent === 'approved') return 'success';
  if (a.sync_consent === 'rejected') return 'danger';
  if (a.sync_consent === 'pending') return 'warning';
  return 'primary';
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
  // The code just issued, shown once in VerificationModal.
  const [issued, setIssued] = useState<(VerificationCode & { name: string; id: string }) | null>(null);
  // The account whose logo sheet is open.
  const [logoFor, setLogoFor] = useState<{ id: string; name: string; hasLogo: boolean; kind: BrandKind } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setAccounts(await listAccounts());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // A user's answer to a sync request arrives at once on the live line.
  const accountsRef = useRef<Account[] | null>(null);
  accountsRef.current = accounts;
  useEffect(() => openLive((event, data) => {
    const who = accountsRef.current?.find((x) => x.id === data.id);
    const name = who ? (who.store_name || who.phone) : '';
    if (event === 'registered') {
      void presentToast({ message: '🆕 حساب جديد — بانتظار التحقق', duration: 2500, position: 'top', color: 'primary' });
      void load();
      return;
    }
    if (event === 'verified') {
      void presentToast({ message: `✓ ${name} تحقق من رقمه`, duration: 2500, position: 'top', color: 'success' });
      setIssued((cur) => (cur && cur.id === data.id ? null : cur)); // its job is done
      void load();
      return;
    }
    const yes = data.sync_consent === 'approved';
    void presentToast({
      message: `${yes ? '✓' : '✕'} ${name} ${yes ? 'وافق على المزامنة' : 'رفض المزامنة'}`,
      duration: 2500, position: 'top', color: yes ? 'success' : 'danger',
    });
    void load();
  }), [load, presentToast]);

  const counts = useMemo(() => {
    const c = { all: 0, active: 0, inactive: 0, suspended: 0 };
    for (const a of accounts ?? []) {
      c.all++;
      const s = cardState(a);
      if (s === 'suspended') c.suspended++;
      else if (s === 'activated') c.active++;
      else c.inactive++;
    }
    return c;
  }, [accounts]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = digitsOnly(q);
    return (accounts ?? []).filter((a) => {
      const s = cardState(a);
      if (filter === 'active' && s !== 'activated') return false;
      if (filter === 'inactive' && s !== 'inactive') return false;
      if (filter === 'suspended' && s !== 'suspended') return false;
      if (!q) return true;
      return (
        (a.store_name ?? '').toLowerCase().includes(q) ||
        (qDigits !== '' && a.phone.includes(qDigits))
      );
    });
  }, [accounts, query, filter]);

  const doChange = async (a: Account, status: 'active' | 'none' | 'suspended', code: string, direct = false) => {
    const activating = status === 'active';
    setBusyId(a.id);
    try {
      await setAccountStatus(a.id, status, code, direct);
      presentToast({
        // Switching sync on ASKS the shopkeeper; it starts when he approves.
        message: activating ? 'تم تفعيل المزامنة'
          : status === 'none' ? 'تم إيقاف المزامنة' : 'تم الإيقاف',
        duration: 1800,
        color: activating ? 'success' : 'danger',
      });
      await load();
    } catch (err) {
      presentToast({
        message: err instanceof ApiError ? arabicAdminError(err) : 'تعذّر التنفيذ',
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
        message: err instanceof ApiError ? arabicAdminError(err) : 'تعذّر التنفيذ',
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
    if (activating && a.sync_consent !== 'approved') { sendRequest(a); return; } // the user's yes first
    presentAlert({
      header: 'دفتر المقاول',
      message: activating
        ? `تفعيل «دفتر المقاول» لـ«${who}»؟`
        : `إيقاف «دفتر المقاول» لـ«${who}»؟ البيانات تبقى.`,
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
        message: err instanceof ApiError ? arabicAdminError(err) : 'تعذّر التنفيذ',
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
        ? `تفعيل نسخ Google Drive لـ«${who}»؟`
        : `إيقاف نسخ Google Drive لـ«${who}»؟ النسخ السابقة تبقى.`,
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
        ? `تفعيل نقطة البيع لـ«${who}»؟`
        : `إيقاف نقطة البيع لـ«${who}»؟ البيانات تبقى.`,
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

  // Staff accounts for the shop's POS (cashier / adder / admin): same gate.
  const changePosStaff = (a: Account) => {
    const who = a.store_name || a.phone;
    const enabling = !a.pos_staff_enabled;
    presentAlert({
      header: 'حسابات الموظفين',
      message: enabling
        ? `تفعيل حسابات الموظفين لـ«${who}»؟`
        : `إيقاف حسابات الموظفين لـ«${who}»؟ لا يُحذف أحد.`,
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: enabling ? 'تفعيل' : 'إيقاف',
          role: enabling ? 'confirm' : 'destructive',
          handler: () => {
            setTimeout(() => {
              void ask('حسابات الموظفين').then((code) => {
                if (code) {
                  void run(a, () => setPosStaffAccess(a.id, enabling, code),
                    enabling ? 'تم تفعيل حسابات الموظفين' : 'تم إيقاف حسابات الموظفين');
                }
              });
            }, 350);
          },
        },
      ],
    });
  };

  // «عدة أجهزة»: one account on several phones — each entry says who recorded it.
  const changeMultiDevice = (a: Account) => {
    const who = a.store_name || a.phone;
    const enabling = !a.multi_device;
    presentAlert({
      header: 'عدة أجهزة',
      message: enabling ? `تفعيل «عدة أجهزة» لـ«${who}»؟` : `إيقاف «عدة أجهزة» لـ«${who}»؟`,
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: enabling ? 'تفعيل' : 'إيقاف',
          role: enabling ? 'confirm' : 'destructive',
          handler: () => {
            setTimeout(() => {
              void ask('عدة أجهزة').then((code) => {
                if (code) {
                  void run(a, () => setMultiDevice(a.id, enabling, code),
                    enabling ? 'تم تفعيل عدة أجهزة' : 'تم إيقاف عدة أجهزة');
                }
              });
            }, 350);
          },
        },
      ],
    });
  };

  // POS notes: same gate.
  const changePosNotes = (a: Account) => {
    const who = a.store_name || a.phone;
    const enabling = !a.pos_notes_enabled;
    presentAlert({
      header: 'الملاحظات',
      message: enabling
        ? `تفعيل ملاحظات نقطة البيع لـ«${who}»؟`
        : `إيقاف ملاحظات نقطة البيع لـ«${who}»؟ الملاحظات تبقى.`,
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: enabling ? 'تفعيل' : 'إيقاف',
          role: enabling ? 'confirm' : 'destructive',
          handler: () => {
            setTimeout(() => {
              void ask('الملاحظات').then((code) => {
                if (code) {
                  void run(a, () => setPosNotesAccess(a.id, enabling, code),
                    enabling ? 'تم تفعيل الملاحظات' : 'تم إيقاف الملاحظات');
                }
              });
            }, 350);
          },
        },
      ],
    });
  };

  // The staff report for the shop owner: same gate.
  const changePosReport = (a: Account) => {
    const who = a.store_name || a.phone;
    const enabling = !a.pos_report_enabled;
    presentAlert({
      header: 'تقرير الموظفين',
      message: enabling
        ? `تفعيل تقرير الموظفين لـ«${who}»؟`
        : `إيقاف تقرير الموظفين عن «${who}»؟`,
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: enabling ? 'تفعيل' : 'إيقاف',
          role: enabling ? 'confirm' : 'destructive',
          handler: () => {
            setTimeout(() => {
              void ask('تقرير الموظفين').then((code) => {
                if (code) {
                  void run(a, () => setPosReportAccess(a.id, enabling, code),
                    enabling ? 'تم تفعيل التقرير' : 'تم إيقاف التقرير');
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
        message: err instanceof ApiError ? arabicAdminError(err) : 'تعذّر التنفيذ',
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
      message: 'يظهر على هاتفه بعد المزامنة.',
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
      message: `كلمة مرور جديدة لـ«${who}» (6 أحرف على الأقل).`,
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
      message: `إيقاف مزامنة «${who}»؟ البيانات تبقى محفوظة.`,
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

  // «مفعّل» ↔ «موقوف»: may this account use the app at all. Allowing it again
  // puts it back to 'none' (the app works, server sync off) — a suspended
  // account has had its sync cut anyway, and sync is switched on from «المزيد».
  const allowUse = (a: Account) => {
    const who = a.store_name || a.phone;
    presentAlert({
      header: 'السماح بالاستخدام',
      message: `السماح لـ«${who}» باستخدام التطبيق؟`,
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: 'تفعيل',
          role: 'confirm',
          handler: () => {
            setTimeout(() => {
              void ask('السماح بالاستخدام').then((code) => { if (code) void doChange(a, 'none', code); });
            }, 350);
          },
        },
      ],
    });
  };

  // Server sync starts with the USER's yes: first a request (no code), their
  // app asks ✓ / ✗, and only once they agreed can it be switched on (with a code).
  const sendRequest = (a: Account) => {
    presentAlert({
      header: 'طلب مزامنة',
      message: a.sync_consent === 'pending' ? 'لم يرد بعد. إرسال الطلب مرة أخرى؟' : 'إرسال طلب المزامنة إلى المستخدم؟',
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: 'إرسال طلب',
          role: 'confirm',
          handler: () => {
            void run(a, () => requestSync(a.id), 'أُرسل الطلب');
          },
        },
      ],
    });
  };
  // Phone verification: a fresh code, shown once, sent from this phone.
  const sendCode = async (a: Account) => {
    setBusyId(a.id);
    try {
      const code = await issueVerificationCode(a.id);
      setIssued({ ...code, id: a.id, name: a.store_name || 'بدون اسم' });
    } catch (err) {
      void presentToast({ message: err instanceof ApiError ? err.message : 'تعذّر إنشاء الرمز', duration: 2500, color: 'danger' });
    } finally {
      setBusyId(null);
    }
  };

  /** The sync row's action when sync is OFF: verify the number, ask, then switch on. */
  const syncOn = (a: Account) => {
    if (a.phone_verified === false) {
      void presentToast({ message: '🛡️ أرسل رمز التحقق أولاً', duration: 1800, color: 'warning' });
      void sendCode(a);
      return;
    }
    if (a.activated === false) {
      void presentToast({ message: 'فعّل الحساب أولاً', duration: 1800, color: 'warning' });
      return;
    }
    if (a.sync_consent === 'approved') change(a, 'active'); else sendRequest(a);
  };

  // «شعار المتجر»: the sheet picks + previews; saving needs a fresh code.
  const saveLogo = (logo: string | null) => {
    const target = logoFor;
    setLogoFor(null);
    if (!target) return;
    setTimeout(() => {
      const what = target.kind === 'intro' ? 'صورة الترحيب' : 'الشعار';
      void ask(logo ? `حفظ ${what}` : `إزالة ${what}`).then(async (code) => {
        if (!code) return;
        setBusyId(target.id);
        try {
          await setLogo(target.id, logo, code, target.kind);
          void presentToast({ message: logo ? `تم حفظ ${what} ✓` : `أُزيل ${what}`, duration: 1800, color: 'success' });
          await load();
        } catch (err) {
          void presentToast({ message: err instanceof ApiError ? err.message : 'تعذّر الحفظ', duration: 2500, color: 'danger' });
        } finally {
          setBusyId(null);
        }
      });
    }, 350);
  };

  // «نوع الحساب»: grocery ↔ club. The app opens the matching section (Phase 43).
  const changeType = (a: Account) => {
    const toClub = a.account_type !== 'club';
    const who = a.store_name || a.phone;
    presentAlert({
      header: 'نوع الحساب',
      message: toClub ? `تحويل «${who}» إلى نادٍ رياضي؟` : `تحويل «${who}» إلى بقالة؟`,
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: 'تحويل', role: 'confirm',
          handler: () => {
            setTimeout(() => {
              void ask('نوع الحساب').then(async (code) => {
                if (!code) return;
                setBusyId(a.id);
                try {
                  await setAccountType(a.id, toClub ? 'club' : 'grocery', code);
                  void presentToast({ message: toClub ? 'أصبح نادياً ✓' : 'أصبح بقالة ✓', duration: 1800, color: 'success' });
                  await load();
                } catch (err) {
                  void presentToast({ message: err instanceof ApiError ? err.message : 'تعذّر التنفيذ', duration: 2500, color: 'danger' });
                } finally {
                  setBusyId(null);
                }
              });
            }, 350);
          },
        },
      ],
    });
  };

  /** Tap a status icon → its name, since icons alone can be ambiguous. */
  const sayIcon = (text: string) =>
    void presentToast({ message: text, duration: 1400, position: 'top', color: 'dark' });

  // «تفعيل» — approve the account (023). Server sync stays a separate switch.
  const doActivation = async (a: Account, active: boolean, code: string) => {
    setBusyId(a.id);
    try {
      await setActivation(a.id, active, code);
      void presentToast({ message: active ? 'تم التفعيل ✓' : 'أُلغي التفعيل', duration: 1800, color: active ? 'success' : 'medium' });
      await load();
    } catch (err) {
      void presentToast({ message: err instanceof ApiError ? arabicAdminError(err) : 'تعذّر التنفيذ', duration: 2500, color: 'danger' });
    } finally {
      setBusyId(null);
    }
  };
  const activate = (a: Account) => {
    if (a.phone_verified === false) { void sendCode(a); return; } // the number first
    presentAlert({
      header: 'تفعيل الحساب',
      message: `تفعيل «${a.store_name || a.phone}»؟`,
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: 'تفعيل', role: 'confirm',
          handler: () => { setTimeout(() => { void ask('تفعيل الحساب').then((c) => { if (c) void doActivation(a, true, c); }); }, 350); },
        },
      ],
    });
  };
  const deactivate = (a: Account) => {
    presentAlert({
      header: 'إلغاء التفعيل',
      message: `إلغاء تفعيل «${a.store_name || a.phone}»؟ تتوقف المزامنة.`,
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: 'إلغاء التفعيل', role: 'destructive',
          handler: () => { setTimeout(() => { void ask('إلغاء التفعيل').then((c) => { if (c) void doActivation(a, false, c); }); }, 350); },
        },
      ],
    });
  };

  // «تفعيل مباشر»: no request — for users on the old Play app, which cannot answer one.
  const directOn = (a: Account) => {
    const who = a.store_name || a.phone;
    presentAlert({
      header: 'تفعيل مباشر',
      message: `تفعيل مزامنة «${who}» دون طلب؟`,
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: 'تفعيل',
          role: 'confirm',
          handler: () => {
            setTimeout(() => {
              void ask('تفعيل مباشر').then((code) => { if (code) void doChange(a, 'active', code, true); });
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
      header: activating ? 'تفعيل المزامنة' : 'إيقاف الحساب',
      message: activating
        ? `وافق «${who}» ✓. تفعيل المزامنة الآن؟`
        : `إيقاف «${who}»؟ لن يدخل حتى تعيد تفعيله. البيانات تبقى.`,
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: activating ? 'تفعيل' : 'إيقاف',
          role: activating ? 'confirm' : 'destructive',
          handler: () => {
            // Let the confirm alert finish dismissing before the code modal opens.
            setTimeout(() => {
              void ask(activating ? 'تفعيل المزامنة' : 'إيقاف الحساب').then((code) => {
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
              <IonItem
                button detail
                onClick={() => pick((a) => (effectiveStatus(a) === 'active' ? syncOff(a) : syncOn(a)))}
              >
                <IonLabel>مزامنة الخادم</IonLabel>
                <IonNote slot="end" color={syncNoteColor(managed)}>{syncNote(managed)}</IonNote>
              </IonItem>
            )}
            {effectiveStatus(managed) !== 'suspended' && effectiveStatus(managed) !== 'active' && (
              <IonItem button detail onClick={() => pick(directOn)}>
                <IonLabel>تفعيل المزامنة مباشرة ⚡</IonLabel>
                <IonNote slot="end">دون طلب</IonNote>
              </IonItem>
            )}
            {effectiveStatus(managed) !== 'suspended' && (
              <IonItem button detail onClick={() => pick(changeMultiDevice)}>
                <IonLabel>عدة أجهزة 📱📱</IonLabel>
                <IonNote slot="end">{managed.multi_device ? 'مفعّل' : 'متوقف'}</IonNote>
              </IonItem>
            )}
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
            {managed.pos_enabled && (
              <IonItem button detail onClick={() => pick(changePosStaff)}>
                <IonLabel>حسابات الموظفين</IonLabel>
                <IonNote slot="end">{managed.pos_staff_enabled ? 'مفعّل' : 'متوقف'}</IonNote>
              </IonItem>
            )}
            {managed.pos_enabled && (
              <IonItem button detail onClick={() => pick(changePosNotes)}>
                <IonLabel>الملاحظات</IonLabel>
                <IonNote slot="end">{managed.pos_notes_enabled ? 'مفعّل' : 'متوقف'}</IonNote>
              </IonItem>
            )}
            {managed.pos_staff_enabled && (
              <IonItem button detail onClick={() => pick(changePosReport)}>
                <IonLabel>تقرير الموظفين (لصاحب المتجر)</IonLabel>
                <IonNote slot="end">{managed.pos_report_enabled ? 'مفعّل' : 'متوقف'}</IonNote>
              </IonItem>
            )}
            {managed.pos_enabled && (
              <IonItem button detail onClick={() => { const id = managed.id; setManageId(null); setTimeout(() => router.push(`/accounts/${id}/notes`), 350); }}>
                <IonLabel>عرض الملاحظات</IonLabel>
              </IonItem>
            )}
            {managed.pos_staff_enabled && (
              <IonItem button detail onClick={() => { const id = managed.id; setManageId(null); setTimeout(() => router.push(`/accounts/${id}/staff`), 350); }}>
                <IonLabel>عرض تقارير الموظفين</IonLabel>
              </IonItem>
            )}

            <IonListHeader><IonLabel>الحساب</IonLabel></IonListHeader>
            <IonItem button detail onClick={() => pick(changeType)}>
              <IonLabel>نوع الحساب</IonLabel>
              <IonNote slot="end">{managed.account_type === 'club' ? 'نادٍ رياضي' : 'بقالة'}</IonNote>
            </IonItem>
            <IonItem button detail onClick={() => pick((a) => void sendCode(a))}>
              <IonLabel>رمز التحقق</IonLabel>
              <IonNote slot="end" color={managed.phone_verified === false ? 'warning' : 'success'}>
                {managed.phone_verified === false ? 'غير متحقق' : 'متحقق ✓'}
              </IonNote>
            </IonItem>
            <IonItem button detail onClick={() => pick((a) => setLogoFor({ id: a.id, name: a.store_name || a.phone, hasLogo: a.has_logo === true, kind: 'logo' }))}>
              <IonLabel>شعار المتجر</IonLabel>
              <IonNote slot="end">{managed.has_logo ? 'موجود' : 'لا يوجد'}</IonNote>
            </IonItem>
            <IonItem button detail onClick={() => pick((a) => setLogoFor({ id: a.id, name: a.store_name || a.phone, hasLogo: a.has_intro === true, kind: 'intro' }))}>
              <IonLabel>صورة الترحيب</IonLabel>
              <IonNote slot="end">{managed.has_intro ? 'موجودة' : 'لا توجد'}</IonNote>
            </IonItem>
            <IonItem button detail onClick={() => pick(rename)}><IonLabel>تغيير الاسم</IonLabel></IonItem>
            <IonItem button detail onClick={() => pick(changePassword)}><IonLabel>كلمة المرور</IonLabel></IonItem>

            <IonListHeader><IonLabel>منطقة الخطر</IonLabel></IonListHeader>
            {cardState(managed) === 'activated' && (
              <IonItem button detail={false} onClick={() => pick(deactivate)}>
                <IonLabel color="danger">إلغاء التفعيل</IonLabel>
              </IonItem>
            )}
            {cardState(managed) === 'inactive' && (
              <IonItem button detail={false} onClick={() => pick((a) => change(a, 'suspended'))}>
                <IonLabel color="danger">إيقاف الحساب</IonLabel>
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
            <IonSegmentButton value="active"><IonLabel>مفعّل</IonLabel></IonSegmentButton>
            <IonSegmentButton value="inactive"><IonLabel>غير مفعّل</IonLabel></IonSegmentButton>
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
          <div className="summary__chip"><div className="summary__num">{counts.active}</div><div className="summary__label">مفعّل</div></div>
          <div className="summary__chip"><div className="summary__num">{counts.inactive}</div><div className="summary__label">غير مفعّل</div></div>
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
          const s = cardState(a);
          return (
            <div key={a.id} className="acct">
              <div className="acct__top">
                <div>
                  <div className="acct__name">{a.store_name || 'بدون اسم'}</div>
                  {a.contractor_store_name && <div className="acct__phone">المقاول: {a.contractor_store_name}</div>}
                  <div className="acct__phone">{a.phone}</div>
                </div>
                <div className="acct__badges">
                  {/* Icons, not words: allowed ✓ / suspended ⦸, and a shield while the number is unverified. */}
                  <IonIcon
                    className={`status-ic status-ic--${s === 'activated' ? 'active' : s}`}
                    icon={s === 'suspended' ? banOutline : s === 'activated' ? checkmarkCircle : ellipseOutline}
                    aria-label={CARD_AR[s]} title={CARD_AR[s]} role="button"
                    onClick={() => sayIcon(CARD_AR[s])}
                  />
                  {a.phone_verified === false && (
                    <IonIcon
                      className="status-ic status-ic--unverified" icon={shieldOutline} aria-label="غير متحقق" title="غير متحقق"
                      role="button" onClick={() => sayIcon('الرقم غير متحقق')}
                    />
                  )}
                </div>
              </div>
              {s !== 'suspended' && <FeatureIcons account={a} />}
              <div className="acct__meta">
                جهات: {a.customers_count} · حركات: {a.transactions_count}
                <br />
                التسجيل: <span className="ltr">{dateTime(a.created_at)}</span>
                <br />
                آخر حركة: <span className="ltr">{dateTime(a.last_transaction_at ?? null)}</span>
                <br />
                آخر نشاط: <span className="ltr">{dateTime(a.last_seen_at ?? null)}</span>
              </div>
              <div className="acct__actions">
                <IonButton size="small" fill="outline" onClick={() => router.push(`/accounts/${a.id}`)}>
                  فتح الدفتر
                </IonButton>
                {/* The one switch that matters most. Not activated → «تفعيل» (code first
                    if the number is unverified); activated → tap to suspend;
                    suspended → tap to allow again. Sync is in «المزيد». */}
                {s === 'activated' ? (
                  <IonButton size="small" disabled={busyId === a.id} onClick={() => change(a, 'suspended')}>مفعّل</IonButton>
                ) : s === 'suspended' ? (
                  <IonButton size="small" fill="outline" color="danger" disabled={busyId === a.id} onClick={() => allowUse(a)}>
                    موقوف · سماح
                  </IonButton>
                ) : (
                  <IonButton size="small" color="warning" disabled={busyId === a.id} onClick={() => activate(a)}>تفعيل</IonButton>
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
      <LogoModal account={logoFor} onClose={() => setLogoFor(null)} onSave={saveLogo} />
      <VerificationModal
        issued={issued}
        onClose={() => setIssued(null)}
        onNewCode={() => {
          const a = accounts?.find((x) => x.id === issued?.id);
          if (a) void sendCode(a);
        }}
      />
    </IonPage>
  );
};

export default Accounts;
