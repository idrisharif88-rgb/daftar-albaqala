import { useState, type ReactNode } from 'react';
import {
  IonItem, IonLabel, IonList, IonNote, IonText, IonSpinner, useIonAlert, useIonToast,
} from '@ionic/react';
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

// «البيانات»: Settings passes its sync and export rows as children, and the
// backup rows follow them in one list. Two ways to get a copy of the book,
// because the grocers differ: some want it in their own Google Drive; others
// will not hand their data to Google and would rather ask the developer. So:
//   - «طلب نسخة من بياناتي» — always here: a WhatsApp message to the owner.
//   - Google Drive backup — only for accounts the owner granted it to (Watcher),
//     and only once the grocer links his own Google account. Nothing goes to
//     Google until he taps.
const BackupSection: React.FC<{ senderName: string; children?: ReactNode }> = ({ senderName, children }) => {
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

  const driveOn = driveBackupAllowed && GOOGLE_ENABLED;

  return (
    <>
      <h2 className="settings-section">البيانات</h2>
      <IonList>
        {children}
        {driveOn && (
          <>
            <IonItem button detail={false} onClick={() => void doBackup()} disabled={!!busy}>
              <IonLabel>نسخ الآن إلى Google Drive</IonLabel>
              {busy === 'backup' && <IonSpinner slot="end" name="crescent" />}
            </IonItem>
            <IonItem button detail={false} onClick={confirmRestore} disabled={!!busy}>
              <IonLabel>استعادة من Google Drive</IonLabel>
              {busy === 'restore' && <IonSpinner slot="end" name="crescent" />}
            </IonItem>
            {email && (
              <IonItem button detail={false} onClick={() => void unlink()} disabled={!!busy}>
                <IonLabel>فك ربط حساب Google</IonLabel>
              </IonItem>
            )}
          </>
        )}
        <IonItem button detail={false} onClick={() => void requestCopy()}>
          <IonLabel>طلب نسخة من بياناتي</IonLabel>
        </IonItem>
      </IonList>

      {driveOn && (
        <IonNote color="medium" className="ion-padding-start" style={{ display: 'block' }}>
          <IonText className="pre-line">
            {email ? `حساب Google: ${email}` : 'لم يُربط حساب Google بعد.'}
            {'\n'}
            {last ? `آخر نسخة: ${stamp(last)}` : 'لم تُحفظ نسخة بعد.'}
            {'\n'}
            النسخة في مجلد خاص بالتطبيق داخل Google Drive الخاص بك، لا يراه غيره.
            تُحفظ نسخة تلقائياً مرة كل يوم.
          </IonText>
        </IonNote>
      )}
    </>
  );
};

export default BackupSection;
