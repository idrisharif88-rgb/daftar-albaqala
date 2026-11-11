import { useCallback, useEffect, useState } from 'react';
import {
  IonButton, IonContent, IonIcon, IonInput, IonItem, IonList, IonModal, IonNote, IonText,
} from '@ionic/react';
import { phonePortraitOutline } from 'ionicons/icons';
import { useAuth } from '../lib/auth';
import { toLatinDigits } from '../lib/digits';
import { getDeviceUser, isCodeLocked, saveDeviceUser } from '../data/deviceUser';

// «عدة أجهزة»: asks once per phone who uses it — a name and the last 3 digits
// of their own number. Opens by itself while the account is multi-device and
// this phone has no answer; Settings reopens it to correct the name (the
// digits lock once an entry carries them — see data/deviceUser.ts).
// It can always be skipped («لاحقاً», back, outside): entries are then saved
// without a name, and it asks again on the next app open.

export const EDIT_DEVICE_USER_EVENT = 'daftar:edit-device-user';
export const DEVICE_USER_CHANGED_EVENT = 'daftar:device-user-changed';

const DeviceUserPrompt: React.FC = () => {
  const { multiDevice } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = useCallback(async () => {
    const current = await getDeviceUser();
    setName(current?.name ?? '');
    setCode(current?.code ?? '');
    setLocked(await isCodeLocked());
    setError(null);
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!multiDevice) { setOpen(false); return; }
    void getDeviceUser().then((u) => { if (!u) void show(); });
  }, [multiDevice, show]);

  useEffect(() => {
    const onEdit = () => { void show(); };
    window.addEventListener(EDIT_DEVICE_USER_EVENT, onEdit);
    return () => window.removeEventListener(EDIT_DEVICE_USER_EVENT, onEdit);
  }, [show]);

  const save = async () => {
    try {
      await saveDeviceUser(name, code);
      setOpen(false);
      window.dispatchEvent(new Event(DEVICE_USER_CHANGED_EVENT));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر الحفظ');
    }
  };

  return (
    <IonModal
      isOpen={open}
      onDidDismiss={() => setOpen(false)}
    >
      <IonContent className="ion-padding">
        <h2 style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <IonIcon icon={phonePortraitOutline} aria-hidden="true" /> من يستخدم هذا الهاتف؟
        </h2>
        <IonText color="medium">
          <p>كل حركة تُسجَّل من هذا الهاتف تحمل الاسم والأرقام، وتبدأ أرقام فواتيره بها.</p>
        </IonText>
        <IonList>
          <IonItem>
            <IonInput
              label="الاسم" labelPlacement="stacked" value={name} maxlength={40}
              placeholder="مثال: أحمد"
              onIonInput={(e) => setName(e.detail.value ?? '')}
            />
          </IonItem>
          <IonItem>
            <IonInput
              label="آخر 3 أرقام من رقمك" labelPlacement="stacked" value={code}
              inputmode="numeric" maxlength={3} placeholder="727" disabled={locked}
              onIonInput={(e) => setCode(toLatinDigits(e.detail.value ?? '').replace(/\D/g, '').slice(0, 3))}
            />
          </IonItem>
        </IonList>
        {locked && <IonNote color="medium">🔒 الأرقام ثابتة بعد أول حركة.</IonNote>}
        {error && <IonText color="danger"><p>{error}</p></IonText>}
        <IonButton expand="block" className="ion-margin-top" onClick={() => void save()}>حفظ</IonButton>
        <IonButton expand="block" fill="clear" onClick={() => setOpen(false)}>لاحقاً</IonButton>
      </IonContent>
    </IonModal>
  );
};

export default DeviceUserPrompt;
