import { useState } from 'react';
import {
  IonButton, IonIcon, IonNote, IonText, IonSpinner, useIonAlert, useIonToast,
} from '@ionic/react';
import { logoGoogle, logoWhatsapp } from 'ionicons/icons';
import { useAuth } from '../lib/auth';
import { openWhatsApp } from '../lib/notify';
import { GOOGLE_ENABLED, linkedEmail, unlinkGoogle } from '../lib/googleDrive';
import { backupNow, restoreBackup, lastBackupAt } from '../data/driveBackup';
import { FLAVOR } from '../flavors';

// The owner's WhatsApp — where «طلب نسخة من بياناتي» goes. Same number as the
// activation request in Settings.
const OWNER_WHATSAPP = '779412972';

const stamp = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// «النسخ الاحتياطي». Two ways to get a copy of the book, because the grocers
// differ: some want it in their own Google Drive; others will not hand their
// data to Google and would rather ask the developer. So:
//   - «طلب نسخة من بياناتي» — always here: a WhatsApp message to the owner.
//   - Google Drive backup — only for accounts the owner granted it to (Watcher),
//     and only once the grocer links his own Google account. Nothing goes to
//     Google until he taps.
const BackupSection: React.FC<{ senderName: string }> = ({ senderName }) => {
  const { driveBackupAllowed } = useAuth();
  const [email, setEmail] = useState<string | null>(linkedEmail);
  const [last, setLast] = useState<number>(lastBackupAt);
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);
  const [presentToast] = useIonToast();
  const [presentAlert] = useIonAlert();

  const fail = (err: unknown) => presentToast({
    message: err instanceof Error && /[؀-ۿ]/.test(err.message)
      ? err.message
      : 'تعذّر الوصول إلى Google Drive. تحقق من الاتصال وحاول مجدداً.',
    color: 'danger',
    duration: 3500,
  });

  const requestCopy = async () => {
    const who = senderName ? `\nالاسم: ${senderName}` : '';
    const opened = await openWhatsApp(
      OWNER_WHATSAPP, `مرحباً، أرجو إرسال نسخة من بياناتي في تطبيق ${FLAVOR.appName}.${who}`,
    );
    if (!opened) {
      await presentToast({ message: 'واتساب غير مثبّت على هذا الجهاز', color: 'warning', duration: 2500 });
    }
  };

  const doBackup = async () => {
    setBusy('backup');
    try {
      const savedAt = await backupNow({ interactive: true });
      setEmail(linkedEmail());
      if (savedAt) {
        setLast(savedAt);
        await presentToast({ message: 'تم حفظ النسخة في Google Drive', color: 'success', duration: 2000 });
      }
    } catch (err) {
      await fail(err);
    } finally {
      setBusy(null);
    }
  };

  const doRestore = async () => {
    setBusy('restore');
    try {
      const changed = await restoreBackup();
      setEmail(linkedEmail());
      await presentToast({
        message: changed === null
          ? 'لا توجد نسخة في Google Drive بعد'
          : changed === 0 ? 'الدفتر مطابق للنسخة — لا شيء جديد' : `تمت الاستعادة: ${changed} سجل`,
        color: changed ? 'success' : 'medium',
        duration: 3000,
      });
    } catch (err) {
      await fail(err);
    } finally {
      setBusy(null);
    }
  };

  const confirmRestore = () => presentAlert({
    header: 'استعادة من Google Drive',
    message: 'تُضاف إلى الدفتر الجهات والحركات الموجودة في النسخة وغير الموجودة هنا. ' +
      'لا يُحذف شيء من الدفتر الحالي.',
    buttons: [
      { text: 'إلغاء', role: 'cancel' },
      { text: 'استعادة', handler: () => { void doRestore(); } },
    ],
  });

  const unlink = async () => {
    await unlinkGoogle();
    setEmail(null);
  };

  return (
    <>
      <h2 className="settings-section">النسخ الاحتياطي</h2>

      {driveBackupAllowed && GOOGLE_ENABLED && (
        <>
          <IonNote className="ion-padding-start" style={{ display: 'block' }}>
            <IonText className="pre-line">
              {email ? `حساب Google: ${email}` : 'لم يُربط حساب Google بعد.'}
              {'\n'}
              {last ? `آخر نسخة: ${stamp(last)}` : 'لم تُحفظ نسخة بعد.'}
            </IonText>
          </IonNote>
          <IonButton expand="block" className="ion-margin-top" onClick={() => void doBackup()} disabled={!!busy}>
            {busy === 'backup' ? <IonSpinner name="crescent" /> : (
              <><IonIcon slot="start" icon={logoGoogle} />نسخ الآن إلى Google Drive</>
            )}
          </IonButton>
          <IonButton expand="block" fill="outline" onClick={confirmRestore} disabled={!!busy}>
            {busy === 'restore' ? <IonSpinner name="crescent" /> : 'استعادة من Google Drive'}
          </IonButton>
          {email && (
            <IonButton expand="block" fill="clear" size="small" onClick={() => void unlink()} disabled={!!busy}>
              فك ربط حساب Google
            </IonButton>
          )}
          <IonNote color="medium" className="ion-padding-start" style={{ display: 'block' }}>
            <IonText>
              النسخة في مجلد خاص بالتطبيق داخل Google Drive الخاص بك، لا يراه غيره.
              تُحفظ نسخة تلقائياً مرة كل يوم.
            </IonText>
          </IonNote>
        </>
      )}

      <IonButton expand="block" fill="outline" className="ion-margin-top" onClick={() => void requestCopy()}>
        <IonIcon slot="start" icon={logoWhatsapp} />
        طلب نسخة من بياناتي
      </IonButton>
    </>
  );
};

export default BackupSection;
