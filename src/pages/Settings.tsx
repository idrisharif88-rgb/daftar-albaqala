import { useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonButton,
  IonBackButton, IonList, IonItem, IonLabel, IonInput, IonSelect, IonSelectOption,
  IonSpinner, IonNote, IonText, useIonViewWillEnter, useIonToast,
} from '@ionic/react';
import { getSettings, saveSettings, type Settings as AppSettings } from '../data/settings';

// Settings — store name, currency, language. The store name is used in the
// customer notifications (SMS/WhatsApp). The manual sync button lands with the
// sync slice. Settings persist locally in app_meta.
const Settings: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [presentToast] = useIonToast();

  useIonViewWillEnter(() => {
    void getSettings().then(setSettings);
  });

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
          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default Settings;
