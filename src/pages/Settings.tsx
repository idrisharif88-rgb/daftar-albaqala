import { useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonButton,
  IonBackButton, IonList, IonItem, IonLabel, IonInput, IonSelect, IonSelectOption,
  IonToggle, IonSpinner, IonNote, IonText, useIonViewWillEnter, useIonToast,
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
import { openWhatsApp } from '../lib/notify';
import { SYNC_PROBLEM_TEXT } from '../components/SyncWarning';

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
  const [active, setActive] = useState(true); // assume active until we check
  const [rates, setRates] = useState<Rates>(DEFAULT_RATES);
  const [ratesUpdatedAt, setRatesUpdatedAt] = useState<string | null>(null);
  const [presentToast] = useIonToast();

  useIonViewWillEnter(() => {
    void getSettings().then(setSettings);
    void isAccountActive().then(setActive);
    void getRatesState().then((state) => {
      setRates(state.rates);
      setRatesUpdatedAt(state.updatedAt);
    });
  });

  // Open a WhatsApp chat to the owner with a pre-filled activation request. The
  // owner sees the sender's WhatsApp number (proving the grocer owns it) and
  // activates the account on the server. No server call — this is a direct chat.
  const requestActivationFlow = () => {
    const who = settings ? messageSender(settings) : '';
    const msg =
      `مرحباً، أرجو تفعيل حسابي في تطبيق دفتر البقالة.` +
      (who ? `\nالاسم: ${who}` : '');
    openWhatsApp(OWNER_WHATSAPP, msg);
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
      await presentToast({ message: 'تم الحفظ', duration: 1500, color: 'success' });
    } finally {
      setSaving(false);
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
    } catch {
      await presentToast({ message: 'تعذّر إنشاء ملف Excel', color: 'danger', duration: 2500 });
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

            <IonButton
              expand="block"
              fill="outline"
              onClick={doExportExcel}
              disabled={exporting}
              className="ion-margin-top"
            >
              {exporting ? <IonSpinner name="crescent" /> : 'تصدير الدفتر إلى Excel'}
            </IonButton>

            {!active && (
              <div className="ion-margin-top">
                <IonNote color="warning" className="ion-padding-start">
                  <IonText>حسابك غير مفعّل. أرسل طلباً للمالك لتفعيل المزامنة السحابية.</IonText>
                </IonNote>
                <IonButton
                  expand="block"
                  color="warning"
                  onClick={requestActivationFlow}
                  className="ion-margin-top"
                >
                  طلب التفعيل
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
