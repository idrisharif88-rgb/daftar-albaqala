import { useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonButton,
  IonBackButton, IonList, IonItem, IonLabel, IonInput, IonSelect, IonSelectOption,
  IonToggle, IonSpinner, IonNote, IonText, useIonViewWillEnter, useIonToast,
  useIonAlert,
} from '@ionic/react';
import { checkmarkCircle } from 'ionicons/icons';
import {
  getSettings, saveSettings, messageSender, type Settings as AppSettings,
} from '../data/settings';
import { runSync } from '../data/sync';
import { isAccountActive } from '../data/account';
import { getRatesState, saveRates, ratesAreStale, RATE_STALE_AFTER_DAYS } from '../data/rates';
import {
  BASE_CURRENCY, CONVERTIBLE_CURRENCIES, currencyDef, DEFAULT_RATES, type Rates,
} from '../data/currencies';
import { ROLES, type ContactRole } from '../data/roles';
import { openEmail, openUrl, openWhatsApp } from '../lib/notify';
import {
  printingAvailable, listPrinters, getSavedPrinter, savePrinter,
} from '../lib/print';
import { SYNC_PROBLEM_TEXT } from '../components/SyncWarning';
import { useAuth } from '../lib/auth';
import { PRIVACY_URL } from '../config';
import { deleteAccount, ApiError } from '../lib/api';
import { wipeLocalStore } from '../data/owner';
import { INACTIVE_MESSAGE, SUPPORT_EMAIL } from '../data/account';
import { NoShareTargetError, ShareCancelledError } from '../lib/shareTarget';

// The owner's WhatsApp number — activation requests open a chat here. The owner
// verifies the account by matching this sender's WhatsApp number to the phone
// the grocer registered with, then activates on the server.
const OWNER_WHATSAPP = '779412972';

// Settings — store name, exchange rates, default contact role, language,
// notifications, manual sync, and the full-book Excel export.
//
// The rates section is the one that needs care: those numbers decide every YER
// figure the app shows next to a foreign-currency or gold debt, and they go
// stale fast in Yemen. So they are editable here, stamped with when they were
// last touched, and flagged once they are older than a week.
const Settings: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [active, setActive] = useState(true); // assume active until we check
  const { logout } = useAuth();
  const [rates, setRates] = useState<Rates>(DEFAULT_RATES);
  const [ratesUpdatedAt, setRatesUpdatedAt] = useState<string | null>(null);
  // The remembered receipt printer — chosen once, used for every invoice.
  const [printer, setPrinter] = useState<string | null>(null);
  const [presentToast] = useIonToast();
  const [presentAlert] = useIonAlert();

  useIonViewWillEnter(() => {
    void getSettings().then(setSettings);
    void isAccountActive().then(setActive);
    void getRatesState().then((state) => {
      setRates(state.rates);
      setRatesUpdatedAt(state.updatedAt);
    });
    void getSavedPrinter().then(setPrinter);
  });

  // Open a WhatsApp chat to the owner with a pre-filled activation request. The
  // owner sees the sender's WhatsApp number (proving the grocer owns it) and
  // activates the account on the server. No server call — this is a direct chat.
  // Asking to have this account's number verified. Two ways out, because the
  // two audiences differ: the owner's people live on WhatsApp, while a Play
  // reviewer on an emulator has no WhatsApp at all and needs a route that
  // always exists. Email leads for that reason.
  const verificationMessage = () => {
    const who = settings ? messageSender(settings) : '';
    return `مرحباً، أرجو التحقق من رقمي وتفعيل حسابي في تطبيق دفتر البقالة.` +
      (who ? `\nالاسم: ${who}` : '');
  };

  const requestByEmail = async () => {
    const opened = await openEmail(
      SUPPORT_EMAIL, 'تفعيل حساب — دفتر البقالة', verificationMessage(),
    );
    if (!opened) {
      await presentToast({
        message: `لا يوجد تطبيق بريد. راسلنا على ${SUPPORT_EMAIL}`,
        color: 'warning',
        duration: 4000,
      });
    }
  };

  const requestByWhatsApp = async () => {
    const opened = await openWhatsApp(OWNER_WHATSAPP, verificationMessage());
    if (!opened) {
      await presentToast({
        message: 'واتساب غير مثبّت على هذا الجهاز',
        color: 'warning',
        duration: 2500,
      });
    }
  };

  // Deleting the account. Play requires an app that lets you sign up to let you
  // leave from inside the app, and it is the right thing besides: the book
  // holds other people's names, numbers and debts, and whoever typed them in
  // should be able to take them back without asking anyone.
  //
  // Two confirmations, because there is no undo and no tombstone — the server
  // hard-deletes, and the local store is emptied. The second one makes the
  // owner type the word, so it cannot be reached by two taps in a pocket.
  const confirmDeleteAccount = () => {
    presentAlert({
      header: 'حذف الحساب نهائياً',
      message:
        'سيُحذف حسابك وكل ما فيه: جميع الجهات وأرقامها، وكل الديون والدفعات، ' +
        'وقوائم الأسعار والمجموعات والإعدادات — من هذا الجهاز ومن الخادم معاً.\n\n' +
        'لا يمكن التراجع عن هذا، ولا يمكن استعادة الدفتر بعده.',
      buttons: [
        { text: 'إلغاء', role: 'cancel' },
        { text: 'متابعة', role: 'destructive', handler: () => { typeToConfirm(); } },
      ],
    });
  };

  const typeToConfirm = () => {
    // Deferred so the first alert has finished dismissing before the second
    // presents — two overlays racing leaves one of them orphaned.
    setTimeout(() => {
      presentAlert({
        header: 'تأكيد الحذف',
        message: 'اكتب كلمة «حذف» للتأكيد.',
        inputs: [{ name: 'word', type: 'text', placeholder: 'حذف' }],
        buttons: [
          { text: 'إلغاء', role: 'cancel' },
          {
            text: 'حذف الحساب',
            role: 'destructive',
            handler: (data: { word?: string }) => {
              if ((data.word ?? '').trim() !== 'حذف') {
                void presentToast({
                  message: 'لم تتم كتابة الكلمة بشكل صحيح — لم يُحذف شيء',
                  color: 'warning',
                  duration: 2500,
                });
                return;
              }
              void runDeleteAccount();
            },
          },
        ],
      });
    }, 350);
  };

  const runDeleteAccount = async () => {
    setDeleting(true);
    try {
      // Server FIRST. If this fails the account still exists, and wiping the
      // phone would have destroyed the only copy of anything not yet synced
      // while leaving the account itself standing.
      await deleteAccount();
      await wipeLocalStore();
      logout(); // drops the JWT and returns to the login screen
    } catch (err) {
      await presentToast({
        message: err instanceof ApiError && err.status === 0
          ? 'تعذّر الاتصال بالخادم — لم يُحذف الحساب. حاول عند توفّر الإنترنت'
          : 'تعذّر حذف الحساب. حاول مرة أخرى',
        color: 'danger',
        duration: 3500,
      });
    } finally {
      setDeleting(false);
    }
  };

  const openPrivacyPolicy = async () => {
    const opened = await openUrl(PRIVACY_URL);
    if (!opened) {
      await presentToast({
        message: 'لا يوجد متصفح على هذا الجهاز',
        color: 'warning',
        duration: 2500,
      });
    }
  };

  const update = (patch: Partial<AppSettings>) =>
    setSettings((s) => (s ? { ...s, ...patch } : s));

  // The notifications toggle persists immediately (a toggle that only takes
  // effect after pressing "حفظ" would be confusing).
  const toggleNotify = async (enabled: boolean) => {
    if (!settings) return;
    const next = { ...settings, notifyCustomers: enabled };
    setSettings(next);
    await saveSettings(next);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await saveSettings(settings);
      await saveRates(rates);
      setRatesUpdatedAt(new Date().toISOString());
      // The name and the rates belong to the ACCOUNT, so get them to the
      // server while the owner is still here. Fire-and-forget: they are saved
      // locally either way, and offline this simply no-ops.
      void runSync();
      await presentToast({ message: 'تم الحفظ', duration: 1500, color: 'success' });
    } finally {
      setSaving(false);
    }
  };

  // Pick the receipt printer from Android's PAIRED devices. Pairing itself
  // happens in Android's own Bluetooth settings — it needs a PIN and a system
  // dialog, neither of which an app can stand in for.
  const choosePrinter = async () => {
    try {
      const devices = await listPrinters();
      if (devices.length === 0) {
        presentAlert({
          header: 'لا توجد أجهزة',
          message: 'اقرن الطابعة أولاً من إعدادات البلوتوث في الهاتف، ثم عد إلى هنا.',
          buttons: ['حسناً'],
        });
        return;
      }
      presentAlert({
        header: 'اختر الطابعة',
        inputs: devices.map((d) => ({
          type: 'radio' as const,
          label: d.name ? `${d.name} (${d.address})` : d.address,
          value: d.address,
          checked: d.address === printer,
        })),
        buttons: [
          { text: 'إلغاء', role: 'cancel' },
          {
            text: 'حفظ',
            handler: (address: string) => {
              if (!address) return;
              void (async () => {
                await savePrinter(address);
                setPrinter(address);
                await presentToast({ message: 'تم اختيار الطابعة', duration: 1500, color: 'success' });
              })();
            },
          },
        ],
      });
    } catch (err) {
      presentAlert({
        header: 'تعذّر قراءة الأجهزة',
        message: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
        buttons: ['حسناً'],
      });
    }
  };

  // A rate field holds a price, not a balance — parsed leniently (Arabic
  // keyboards send a comma for the decimal point) and zero means "not set".
  const updateRate = (code: keyof Rates, raw: string) => {
    const parsed = Number(raw.replace(',', '.'));
    setRates((r) => ({ ...r, [code]: Number.isFinite(parsed) && parsed > 0 ? parsed : 0 }));
  };

  const doExportExcel = async () => {
    setExporting(true);
    try {
      // Loaded on demand: the xlsx writer is a big dependency that most sessions
      // never touch, and startup on a cheap Android is the scarce resource.
      const { exportWorkbook } = await import('../lib/excel');
      await exportWorkbook({ storeName: settings ? messageSender(settings) : '', rates });
    } catch (err) {
      // Backing out of the share sheet is not a failure and gets no toast.
      if (!(err instanceof ShareCancelledError)) {
        await presentToast({
          message: err instanceof NoShareTargetError
            ? 'لا يوجد تطبيق يمكنه فتح هذا الملف'
            : 'تعذّر إنشاء ملف Excel',
          color: 'danger',
          duration: 2500,
        });
      }
    } finally {
      setExporting(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await runSync();
      const toast = {
        ok: { message: 'تمت المزامنة', cssClass: 'toast-sync-ok', icon: checkmarkCircle },
        offline: { message: SYNC_PROBLEM_TEXT.offline, color: 'medium' },
        subscription: { message: SYNC_PROBLEM_TEXT.subscription, color: 'warning' },
        error: { message: SYNC_PROBLEM_TEXT.error, color: 'danger' },
        partial: { message: SYNC_PROBLEM_TEXT.partial, color: 'warning' },
      }[r.status];
      await presentToast({ ...toast, duration: 2000 });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/home" text="رجوع" />
          </IonButtons>
          <IonTitle>الإعدادات</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {!settings ? (
          <div className="ion-text-center ion-padding">
            <IonSpinner name="crescent" />
          </div>
        ) : (
          <>
            <IonList>
              <IonItem>
                <IonLabel position="stacked">اسم المتجر</IonLabel>
                <IonInput
                  value={settings.storeName}
                  onIonInput={(e) => update({ storeName: e.detail.value ?? '' })}
                  placeholder="مثال: بقالة الأمل"
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">اسمك</IonLabel>
                <IonInput
                  value={settings.ownerName}
                  onIonInput={(e) => update({ ownerName: e.detail.value ?? '' })}
                  placeholder="يُستخدم في الرسائل إذا لم يكن لديك متجر"
                />
              </IonItem>
              <IonItem>
                <IonLabel>صفة الجهة الافتراضية</IonLabel>
                <IonSelect
                  value={settings.defaultRole}
                  onIonChange={(e) => update({ defaultRole: e.detail.value as ContactRole })}
                  interface="popover"
                >
                  {ROLES.map((r) => (
                    <IonSelectOption key={r.role} value={r.role}>{r.labelAr}</IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>
              <IonItem>
                <IonLabel>اللغة</IonLabel>
                <IonSelect
                  value={settings.language}
                  onIonChange={(e) => update({ language: e.detail.value })}
                  interface="popover"
                >
                  <IonSelectOption value="ar">العربية</IonSelectOption>
                </IonSelect>
              </IonItem>
              <IonItem>
                <IonToggle
                  checked={settings.notifyCustomers}
                  onIonChange={(e) => void toggleNotify(e.detail.checked)}
                >
                  إشعار الجهات (SMS وواتساب)
                </IonToggle>
              </IonItem>
            </IonList>

            <IonNote color="medium" className="ion-padding-start">
              <IonText>
                يظهر اسم المتجر في أول سطر من الرسائل والكشوفات، وإذا تركته فارغاً
                يظهر اسمك بدلاً منه. عند إيقاف الإشعارات لن يتم إرسال أي رسالة عند
                تسجيل دين أو دفعة. «صفة الجهة الافتراضية» هي الصفة المقترحة عند
                إضافة جهة جديدة.
              </IonText>
            </IonNote>

            {/* ---- Exchange rates ---- */}
            <h2 className="settings-section">أسعار الصرف مقابل {currencyDef(BASE_CURRENCY).longAr}</h2>
            <IonList>
              {CONVERTIBLE_CURRENCIES.map((c) => (
                <IonItem key={c.code}>
                  <IonLabel position="stacked">
                    {c.isWeight ? `سعر الجرام (${c.longAr})` : `سعر ${c.longAr}`}
                  </IonLabel>
                  <IonInput
                    type="number"
                    inputmode="decimal"
                    value={rates[c.code] > 0 ? String(rates[c.code]) : ''}
                    onIonInput={(e) => updateRate(c.code, e.detail.value ?? '')}
                    placeholder="غير محدد"
                  />
                </IonItem>
              ))}
            </IonList>

            <IonNote
              color={ratesAreStale(ratesUpdatedAt) ? 'warning' : 'medium'}
              className="ion-padding-start"
            >
              <IonText>
                {ratesUpdatedAt
                  ? `آخر تحديث للأسعار: ${new Date(ratesUpdatedAt).toLocaleDateString('ar')}` +
                    (ratesAreStale(ratesUpdatedAt)
                      ? ` — مضى أكثر من ${RATE_STALE_AFTER_DAYS} أيام، يُنصح بالتحديث.`
                      : '')
                  : 'لم تُحدَّد الأسعار بعد. الديون بالعملات الأخرى والذهب تُحفظ بعملتها، ' +
                    'ولن يظهر ما يقابلها بالريال حتى تُدخل الأسعار.'}
              </IonText>
            </IonNote>

            <IonButton expand="block" onClick={save} disabled={saving} className="ion-margin-top">
              {saving ? <IonSpinner name="crescent" /> : 'حفظ'}
            </IonButton>

            <IonButton
              expand="block"
              fill="outline"
              onClick={sync}
              disabled={syncing}
              className="ion-margin-top"
            >
              {syncing ? <IonSpinner name="crescent" /> : 'مزامنة الآن'}
            </IonButton>

            {/* Receipt printer. Only offered on a build that can actually
                print — on the web the plugin does not exist and the button
                would be a promise the app cannot keep. */}
            {printingAvailable() && (
              <IonButton
                expand="block"
                fill="outline"
                onClick={choosePrinter}
                className="ion-margin-top"
              >
                {printer ? 'تغيير طابعة الفواتير' : 'اختيار طابعة الفواتير'}
              </IonButton>
            )}

            <IonButton
              expand="block"
              fill="outline"
              onClick={doExportExcel}
              disabled={exporting}
              className="ion-margin-top"
            >
              {exporting ? <IonSpinner name="crescent" /> : 'تصدير الدفتر إلى Excel'}
            </IonButton>

            {/* Privacy policy. Not required by Play for an app that collects
                what this one does, but reviewers look for it, and the page has
                to actually exist — a link to a 404 is worse than no link. */}
            <IonButton
              expand="block"
              fill="clear"
              size="small"
              onClick={() => { void openPrivacyPolicy(); }}
              className="ion-margin-top"
            >
              سياسة الخصوصية
            </IonButton>

            {/* Deleting the account lives at the very bottom, apart from
                everything else and behind two confirmations: it is the only
                control in the app with no undo. */}
            <div className="danger-zone">
              <IonNote className="ion-padding-start">
                <IonText>
                  حذف الحساب يمحو كل الجهات والديون والدفعات من هذا الجهاز ومن الخادم نهائياً.
                </IonText>
              </IonNote>
              <IonButton
                expand="block"
                color="danger"
                fill="outline"
                onClick={confirmDeleteAccount}
                disabled={deleting}
                className="ion-margin-top"
              >
                {deleting ? <IonSpinner name="crescent" /> : 'حذف الحساب'}
              </IonButton>
            </div>

            {/* The same words the blocked screens show, so an owner who goes
                looking in Settings finds one answer and not a second one. */}
            {!active && (
              <div className="ion-margin-top">
                <IonNote color="warning" className="ion-padding-start">
                  <IonText className="pre-line">{INACTIVE_MESSAGE}</IonText>
                </IonNote>
                <IonButton
                  expand="block"
                  color="warning"
                  onClick={() => { void requestByEmail(); }}
                  className="ion-margin-top"
                >
                  التواصل عبر البريد الإلكتروني
                </IonButton>
                <IonButton
                  expand="block"
                  fill="outline"
                  color="warning"
                  onClick={() => { void requestByWhatsApp(); }}
                >
                  التواصل عبر واتساب
                </IonButton>
              </div>
            )}
          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default Settings;
