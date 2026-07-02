import { useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonButton,
  IonBackButton, IonList, IonItem, IonLabel, IonInput, IonSelect, IonSelectOption,
  IonToggle, IonSpinner, IonNote, IonText, useIonViewWillEnter, useIonToast,
} from '@ionic/react';
import { checkmarkCircle } from 'ionicons/icons';
import { getSettings, saveSettings, type Settings as AppSettings } from '../data/settings';
import { runSync } from '../data/sync';
import { isAccountActive } from '../data/account';
import { openWhatsApp } from '../lib/notify';

// The owner's WhatsApp number — activation requests open a chat here. The owner
// verifies the account by matching this sender's WhatsApp number to the phone
// the grocer registered with, then activates on the server.
const OWNER_WHATSAPP = '779412972';

// Settings — store name, currency, language. The store name is used in the
// customer notifications (SMS/WhatsApp). The manual sync button lands with the
// sync slice. Settings persist locally in app_meta.
const Settings: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [active, setActive] = useState(true); // assume active until we check
  const [presentToast] = useIonToast();

  useIonViewWillEnter(() => {
    void getSettings().then(setSettings);
    void isAccountActive().then(setActive);
  });

  // Open a WhatsApp chat to the owner with a pre-filled activation request. The
  // owner sees the sender's WhatsApp number (proving the grocer owns it) and
  // activates the account on the server. No server call — this is a direct chat.
  const requestActivationFlow = () => {
    const store = settings?.storeName?.trim();
    const msg =
      `مرحباً، أرجو تفعيل حسابي في تطبيق دفتر البقالة.` +
      (store ? `\nاسم المتجر: ${store}` : '');
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
      await presentToast({ message: 'تم الحفظ', duration: 1500, color: 'success' });
    } finally {
      setSaving(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await runSync();
      const toast = {
        ok: { message: 'تمت المزامنة', cssClass: 'toast-sync-ok', icon: checkmarkCircle },
        offline: { message: 'لا يوجد اتصال بالإنترنت', color: 'medium' },
        subscription: { message: 'المزامنة تتطلب اشتراكاً فعّالاً', color: 'warning' },
        error: { message: 'تعذّرت المزامنة، حاول لاحقاً', color: 'danger' },
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
                <IonLabel>العملة</IonLabel>
                <IonSelect
                  value={settings.currency}
                  onIonChange={(e) => update({ currency: e.detail.value })}
                  interface="popover"
                >
                  <IonSelectOption value="YER">YER</IonSelectOption>
                  <IonSelectOption value="SAR">SAR</IonSelectOption>
                  <IonSelectOption value="USD">USD</IonSelectOption>
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
                  إشعار العملاء (SMS وواتساب)
                </IonToggle>
              </IonItem>
            </IonList>

            <IonNote color="medium" className="ion-padding-start">
              <IonText>
                اسم المتجر يظهر في الرسائل المرسلة للعملاء. عند إيقاف الإشعارات لن
                يتم إرسال أي رسالة عند تسجيل دين أو دفعة.
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
