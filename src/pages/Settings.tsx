import { useEffect, useRef, useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonButton,
  IonBackButton, IonList, IonItem, IonLabel, IonInput,
  IonToggle, IonSpinner, IonNote, IonText, useIonViewWillEnter, useIonViewWillLeave,
  useIonToast, useIonAlert, useIonActionSheet,
} from '@ionic/react';
import { App as CapacitorApp } from '@capacitor/app';
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
import { openEmail, openUrl, openWhatsApp } from '../lib/notify';
import {
  thermalPrintingAvailable, listPrinters, getSavedPrinter, getSavedPrinterName, savePrinter,
  getPrintMode, setPrintMode, type PrintTarget,
} from '../lib/print';
import { systemPrintAvailable } from '../lib/systemPrint';
import { SYNC_PROBLEM_TEXT } from '../components/SyncWarning';
import { useAuth } from '../lib/auth';
import { PRIVACY_URL } from '../config';
import { deleteAccount, ApiError } from '../lib/api';
import { wipeLocalStore } from '../data/owner';
import { INACTIVE_MESSAGE, SUPPORT_EMAIL } from '../data/account';
import { NoShareTargetError, ShareCancelledError } from '../lib/shareTarget';
import { numericInput } from '../lib/digits';
import { useAppearance, ACCENTS, ACCENT_NAMES } from '../theme/appearance';
import { useAppScale } from '../lib/appScale';
import { onPrefsArrived } from '../lib/prefKeys';
import AppScaleSheet from '../components/AppScaleSheet';
import BackupSection from '../components/BackupSection';
import {
  biometricEnabled, setBiometricEnabled, unlockMethods, verifyFinger, verifyDevicePin,
  BiometricCancelled,
} from '../lib/biometric';
import { FLAVOR } from '../flavors';

// The owner's WhatsApp number — activation requests open a chat here. The owner
// verifies the account by matching this sender's WhatsApp number to the phone
// the grocer registered with, then activates on the server.
const OWNER_WHATSAPP = '779412972';

// How long after the last keystroke a name or rate is written. Long enough not
// to save and sync every digit, short enough that nothing typed is at risk.
const AUTOSAVE_DELAY_MS = 1000;

// Settings — store name, notifications, appearance, exchange rates, sync, backup,
// printer and the full-book Excel export. Everything saves itself: toggles at
// once, typed fields shortly after typing stops and on leaving the screen.
//
// The rates section is the one that needs care: those numbers decide every YER
// figure the app shows next to a foreign-currency or gold debt, and they go
// stale fast in Yemen. So they are editable here, stamped with when they were
// last touched, and flagged once they are older than a week.
const Settings: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [active, setActive] = useState(true); // assume active until we check
  const [version, setVersion] = useState<string | null>(null);
  const { logout, isOwner } = useAuth();
  const { accent, night, cycleAccent, toggleNight } = useAppearance();
  const { scale, setScale } = useAppScale();
  const [scaleOpen, setScaleOpen] = useState(false);
  const [bioOn, setBioOn] = useState(biometricEnabled);
  useEffect(() => onPrefsArrived((keys) => {
    if (keys.includes('biometric')) setBioOn(biometricEnabled());
  }), []);
  const [rates, setRates] = useState<Rates>(DEFAULT_RATES);
  const [ratesUpdatedAt, setRatesUpdatedAt] = useState<string | null>(null);
  // The printer invoices go to — chosen once here, used for every invoice:
  // 'system' = Android's print dialog (any ordinary printer), 'thermal' = the
  // remembered Bluetooth receipt printer.
  const [printMode, setPrintModeState] = useState<PrintTarget>('system');
  const [printer, setPrinter] = useState<string | null>(null);
  const [printerName, setPrinterName] = useState<string | null>(null);
  const [presentToast] = useIonToast();
  const [presentAlert] = useIonAlert();
  const [presentSheet] = useIonActionSheet();

  // The latest values and what still needs writing, in refs so the delayed save
  // and the leave handler read what was typed last, not a stale render's copy.
  const settingsRef = useRef<AppSettings | null>(null);
  const ratesRef = useRef<Rates>(DEFAULT_RATES);
  const dirty = useRef({ settings: false, rates: false });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The running version, for «حول التطبيق». Native only; the row is hidden on web.
  useEffect(() => {
    CapacitorApp.getInfo().then((info) => setVersion(info.version)).catch(() => {});
  }, []);

  useIonViewWillEnter(() => {
    void getSettings().then((s) => { settingsRef.current = s; setSettings(s); });
    void isAccountActive().then(setActive);
    void getRatesState().then((state) => {
      ratesRef.current = state.rates;
      setRates(state.rates);
      setRatesUpdatedAt(state.updatedAt);
    });
    void getSavedPrinter().then(setPrinter);
    void getSavedPrinterName().then(setPrinterName);
    void getPrintMode().then(setPrintModeState);
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
    return `مرحباً، أرجو التحقق من رقمي وتفعيل حسابي في تطبيق ${FLAVOR.appName}.` +
      (who ? `\nالاسم: ${who}` : '');
  };

  const requestByEmail = async () => {
    const opened = await openEmail(
      SUPPORT_EMAIL, `تفعيل حساب — ${FLAVOR.appName}`, verificationMessage(),
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

  // Turning the fingerprint lock on asks for the finger once — proof that this
  // phone can actually check it, before the app starts depending on it.
  const toggleBiometric = async (on: boolean) => {
    if (!on) {
      setBiometricEnabled(false);
      setBioOn(false);
      return;
    }
    const methods = await unlockMethods();
    if (!methods.finger && !methods.pin) {
      setBioOn(false);
      await presentToast({
        message: 'لا توجد بصمة أو قفل شاشة على هذا الجهاز',
        color: 'warning',
        duration: 3000,
      });
      return;
    }
    try {
      // Prove it works before turning it on — with the finger when there is
      // one, else the phone's PIN, the same two ways the lock screen offers.
      if (methods.finger) await verifyFinger(); else await verifyDevicePin();
      setBiometricEnabled(true);
      setBioOn(true);
    } catch (err) {
      setBioOn(false);
      if (!(err instanceof BiometricCancelled)) {
        await presentToast({
          message: err instanceof Error ? err.message : 'تعذّر التحقق من البصمة.',
          color: 'warning',
          duration: 3000,
        });
      }
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

  // Writes only what changed: saveRates stamps «آخر تحديث», so saving rates
  // nobody touched would hide that they have gone stale.
  const flushSaves = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const { settings: settingsChanged, rates: ratesChanged } = dirty.current;
    if (!settingsChanged && !ratesChanged) return;
    dirty.current = { settings: false, rates: false };
    try {
      if (settingsChanged && settingsRef.current) await saveSettings(settingsRef.current);
      if (ratesChanged) {
        await saveRates(ratesRef.current);
        setRatesUpdatedAt(new Date().toISOString());
      }
      // The name and the rates belong to the ACCOUNT, so get them to the
      // server while the owner is still here. Fire-and-forget: they are saved
      // locally either way, and offline this simply no-ops.
      void runSync();
    } catch {
      await presentToast({ message: 'تعذّر الحفظ. حاول مرة أخرى', color: 'danger', duration: 2500 });
    }
  };

  const scheduleSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushSaves(); }, AUTOSAVE_DELAY_MS);
  };

  useIonViewWillLeave(() => { void flushSaves(); });

  const update = (patch: Partial<AppSettings>) => {
    if (!settingsRef.current) return;
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    dirty.current.settings = true;
    scheduleSave();
  };

  // A toggle takes effect at once; only typing waits for a pause.
  const toggleNotify = async (enabled: boolean) => {
    update({ notifyCustomers: enabled });
    await flushSaves();
  };

  // «اختيار الطابعة»: which KIND of printer invoices go to. An ordinary
  // printer needs no setup here — Android's print dialog finds it, and
  // remembers the last one used. A thermal printer goes on to the paired-device
  // list below. The two lists are different controllers (sheet, then alert),
  // so the second one is not swallowed while the first is still closing.
  const choosePrinterKind = () => {
    const buttons: { text: string; role?: string; handler?: () => void }[] = [];
    if (systemPrintAvailable()) {
      buttons.push({ text: 'طابعة عادية (واي فاي)', handler: () => { void selectSystemPrinter(); } });
    }
    if (thermalPrintingAvailable()) {
      buttons.push({ text: 'طابعة حرارية (بلوتوث)', handler: () => { void choosePrinter(); } });
    }
    buttons.push({ text: 'إلغاء', role: 'cancel' });
    void presentSheet({ header: 'اختيار الطابعة', buttons });
  };

  const selectSystemPrinter = async () => {
    await setPrintMode('system');
    setPrintModeState('system');
    await presentToast({
      message: 'تم اختيار الطابعة العادية. ستظهر نافذة الطباعة عند كل طباعة لتختار منها الطابعة.',
      duration: 3000,
      color: 'success',
    });
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
                const name = devices.find((d) => d.address === address)?.name ?? '';
                await savePrinter(address, name);
                await setPrintMode('thermal');
                setPrinter(address);
                setPrinterName(name);
                setPrintModeState('thermal');
                await presentToast({ message: 'تم اختيار الطابعة الحرارية', duration: 1500, color: 'success' });
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
    const next = { ...ratesRef.current, [code]: Number.isFinite(parsed) && parsed > 0 ? parsed : 0 };
    ratesRef.current = next;
    setRates(next);
    dirty.current.rates = true;
    scheduleSave();
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
      await flushSaves();
      const r = await runSync();
      const toast = {
        ok: {
          message: '', icon: checkmarkCircle, cssClass: 'toast-sync-ok', position: 'top' as const,
          htmlAttributes: { 'aria-label': 'تمت المزامنة' },
        },
        offline: { message: SYNC_PROBLEM_TEXT.offline, color: 'medium' },
        subscription: { message: SYNC_PROBLEM_TEXT.subscription, color: 'warning' },
        error: { message: SYNC_PROBLEM_TEXT.error, color: 'danger' },
        partial: { message: SYNC_PROBLEM_TEXT.partial, color: 'warning' },
      }[r.status];
      await presentToast({ ...toast, duration: r.status === 'ok' ? 1200 : 2600 });
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
            {/* The same words the blocked screens show, so an owner who goes
                looking in Settings finds one answer and not a second one. */}
            {!active && (
              <div>
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

            {/* ---- Account ---- */}
            <h2 className="settings-section">الحساب</h2>
            <IonList>
              <IonItem>
                <IonInput
                  className="settings-inline"
                  label="اسم المتجر"
                  labelPlacement="start"
                  value={settings.storeName}
                  onIonInput={(e) => update({ storeName: e.detail.value ?? '' })}
                  placeholder="مثال: بقالة الأمل"
                />
              </IonItem>
              <IonItem>
                <IonInput
                  className="settings-inline"
                  label="اسمك"
                  labelPlacement="start"
                  value={settings.ownerName}
                  onIonInput={(e) => update({ ownerName: e.detail.value ?? '' })}
                  placeholder="غير محدد"
                />
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
                تسجيل دين أو دفعة.
              </IonText>
            </IonNote>

            {/* ---- Look & lock ---- */}
            <h2 className="settings-section">المظهر والأمان</h2>
            <IonList>
              {ACCENTS.length > 1 && (
                <IonItem button detail={false} onClick={cycleAccent}>
                  <IonLabel>لون التطبيق</IonLabel>
                  <IonNote slot="end" color="primary" className="settings-value">{ACCENT_NAMES[accent]}</IonNote>
                </IonItem>
              )}
              <IonItem>
                <IonToggle checked={night} onIonChange={toggleNight}>
                  الوضع الليلي
                </IonToggle>
              </IonItem>
              <IonItem button detail={false} onClick={() => setScaleOpen(true)}>
                <IonLabel>حجم العرض</IonLabel>
                <IonNote slot="end" color="primary" className="settings-value">{scale}%</IonNote>
              </IonItem>
              <IonItem>
                <IonToggle
                  checked={bioOn}
                  onIonChange={(e) => { setBioOn(e.detail.checked); void toggleBiometric(e.detail.checked); }}
                >
                  قفل بالبصمة
                </IonToggle>
              </IonItem>
              {isOwner && (
                <IonItem button routerLink="/notebook">
                  <IonLabel>دفتر التحديثات</IonLabel>
                </IonItem>
              )}
            </IonList>
            <IonNote color="medium" className="ion-padding-start">
              <IonText>
                الوضع الليلي يتبع إعداد الهاتف تلقائياً. عند تفعيل قفل البصمة يُطلب
                إصبعك عند فتح التطبيق، وبعد غيابه أكثر من دقيقة.
              </IonText>
            </IonNote>
            <AppScaleSheet
              isOpen={scaleOpen}
              scale={scale}
              onChange={setScale}
              onClose={() => setScaleOpen(false)}
            />

            {/* ---- Exchange rates ---- */}
            <h2 className="settings-section">أسعار الصرف مقابل {currencyDef(BASE_CURRENCY).longAr}</h2>
            <IonList>
              {CONVERTIBLE_CURRENCIES.map((c) => (
                <IonItem key={c.code}>
                  <IonLabel position="stacked">
                    {c.isWeight ? `سعر الجرام (${c.longAr})` : `سعر ${c.longAr}`}
                  </IonLabel>
                  <IonInput
                    type="text"
                    inputmode="decimal"
                    value={rates[c.code] > 0 ? String(rates[c.code]) : ''}
                    onIonInput={(e) => updateRate(c.code, numericInput(e.detail.value ?? ''))}
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

            {/* ---- Data: sync and export, followed by the backup rows ---- */}
            <BackupSection senderName={messageSender(settings)}>
              <IonItem button detail={false} onClick={sync} disabled={syncing}>
                <IonLabel>مزامنة الآن</IonLabel>
                {syncing && <IonSpinner slot="end" name="crescent" />}
              </IonItem>
              <IonItem button detail={false} onClick={doExportExcel} disabled={exporting}>
                <IonLabel>تصدير الدفتر إلى Excel</IonLabel>
                {exporting && <IonSpinner slot="end" name="crescent" />}
              </IonItem>
            </BackupSection>

            {/* The invoice printer. Offered only where the phone can print at
                all — on the web neither path exists, and the row would be a
                promise the app cannot keep. */}
            {(systemPrintAvailable() || thermalPrintingAvailable()) && (
              <>
                <h2 className="settings-section">الطباعة</h2>
                <IonList>
                  <IonItem button detail={false} onClick={choosePrinterKind}>
                    <IonLabel>الطابعة</IonLabel>
                    <IonNote slot="end" color="primary" className="settings-value">
                      {printMode === 'thermal' && printer ? 'طابعة حرارية' : 'طابعة عادية'}
                    </IonNote>
                  </IonItem>
                </IonList>
                {printMode === 'thermal' && printer && (
                  <IonNote color="medium" className="ion-padding-start" style={{ display: 'block' }}>
                    <IonText>بلوتوث: {printerName || printer}</IonText>
                  </IonNote>
                )}
              </>
            )}

            {/* ---- About ---- Privacy policy: not required by Play for an app
                that collects what this one does, but reviewers look for it, and
                the page has to actually exist. */}
            <h2 className="settings-section">حول التطبيق</h2>
            <IonList>
              <IonItem button detail={false} onClick={() => { void openPrivacyPolicy(); }}>
                <IonLabel>سياسة الخصوصية</IonLabel>
              </IonItem>
              {version && (
                <IonItem>
                  <IonLabel>الإصدار</IonLabel>
                  <IonNote slot="end" color="primary" className="settings-value">{version}</IonNote>
                </IonItem>
              )}
            </IonList>

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

          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default Settings;
