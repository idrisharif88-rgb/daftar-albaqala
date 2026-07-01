import { useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonButton,
  IonBackButton, IonList, IonItem, IonLabel, IonInput, IonSelect, IonSelectOption,
  IonSpinner, IonNote, IonText, useIonViewWillEnter, useIonToast, useIonAlert,
} from '@ionic/react';
import { checkmarkCircle } from 'ionicons/icons';
import { getSettings, saveSettings, type Settings as AppSettings } from '../data/settings';
import { runSync } from '../data/sync';
import { isAccountActive } from '../data/account';
import { requestActivation } from '../lib/api';
import { ApiError } from '../lib/api';

// Settings — store name, currency, language. The store name is used in the
// customer notifications (SMS/WhatsApp). The manual sync button lands with the
// sync slice. Settings persist locally in app_meta.
const Settings: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [active, setActive] = useState(true); // assume active until we check
  const [requesting, setRequesting] = useState(false);
  const [presentToast] = useIonToast();
  const [presentAlert] = useIonAlert();

  useIonViewWillEnter(() => {
    void getSettings().then(setSettings);
    void isAccountActive().then(setActive);
  });

  // Send the activation request to the server, with the grocer's optional note.
  const sendActivationRequest = async (message?: string) => {
    setRequesting(true);
    try {
      await requestActivation(message);
      await presentToast({
        message: 'تم إرسال طلب التفعيل. سيقوم المالك بتفعيل حسابك قريباً.',
        color: 'success', duration: 2500,
      });
    } catch (err) {
      const offline = err instanceof ApiError && err.status === 0;
      await presentToast({
        message: offline
          ? 'لا يوجد اتصال بالإنترنت. حاول عند توفّر الاتصال.'
          : 'تعذّر إرسال الطلب، حاول لاحقاً.',
        color: offline ? 'medium' : 'danger', duration: 2500,
      });
    } finally {
      setRequesting(false);
    }
  };

  // Prompt for an optional note first, then send.
  const requestActivationFlow = () => {
    void presentAlert({
      header: 'طلب تفعيل الحساب',
      message: 'أرسل طلباً للمالك لتفعيل حسابك. يمكنك إضافة ملاحظة (اختياري).',
      inputs: [{ name: 'note', type: 'textarea', placeholder: 'ملاحظة اختيارية (مثل طريقة الدفع)' }],
      buttons: [
        { text: 'إلغاء', role: 'cancel' },
        {
          text: 'إرسال',
          handler: (data) => { void sendActivationRequest(data?.note?.trim() || undefined); },
        },
      ],
    });
  };

  const update = (patch: Partial<AppSettings>) =>
    setSettings((s) => (s ? { ...s, ...patch } : s));

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
            </IonList>

            <IonNote color="medium" className="ion-padding-start">
              <IonText>اسم المتجر يظهر في الرسائل المرسلة للعملاء.</IonText>
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
                  disabled={requesting}
                  className="ion-margin-top"
                >
                  {requesting ? <IonSpinner name="crescent" /> : 'طلب التفعيل'}
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
