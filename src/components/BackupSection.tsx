import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  IonItem, IonLabel, IonList, IonNote, IonText, IonSpinner, useIonAlert, useIonToast,
} from '@ionic/react';
import { useAuth } from '../lib/auth';
import { openWhatsApp } from '../lib/notify';
import { GOOGLE_ENABLED, linkedEmail, unlinkGoogle } from '../lib/googleDrive';
import {
  lastBackupAt, readRemoteBackup, isLocalBookEmpty,
  restoreOffered, markRestoreOffered, ownerUserId, DAY_MS, type RemoteBackup,
} from '../data/driveBackup';
import { FLAVOR } from '../flavors';
import { useDriveBackup } from '../lib/useDriveBackup';

// The owner's WhatsApp — where «طلب نسخة من بياناتي» goes. Same number as the
// activation request in Settings.
const OWNER_WHATSAPP = '779412972';

const stamp = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// «النسخ الاحتياطي»: Settings passes its Excel export row as a child, and the
// backup rows follow it in one list. Server sync has its own section above. Two ways to get a copy of the book,
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
  // What the copy on Drive holds — read from the file itself, never stored.
  const [remote, setRemote] = useState<RemoteBackup | null>(null);
  const [presentToast] = useIonToast();
  const [presentAlert] = useIonAlert();
  // A second alert hook: the restore offer can arrive while another alert is
  // still closing, and one hook keeps only one overlay at a time.
  const [presentOffer] = useIonAlert();
  const driveOn = driveBackupAllowed && GOOGLE_ENABLED;

  // Silent only: Settings opening must never pop Google's window.
  const loadRemote = useCallback(async () => {
    if (!driveOn || !linkedEmail()) { setRemote(null); return null; }
    try {
      const r = await readRemoteBackup({ interactive: false });
      setRemote(r);
      return r;
    } catch {
      setRemote(null);
      return null;
    }
  }, [driveOn]);

  const requestCopy = async () => {
    const who = senderName ? `\nالاسم: ${senderName}` : '';
    const opened = await openWhatsApp(
      OWNER_WHATSAPP, `مرحباً، أرجو إرسال نسخة من بياناتي في تطبيق ${FLAVOR.appName}.${who}`,
    );
    if (!opened) {
      await presentToast({ message: 'واتساب غير مثبّت على هذا الجهاز', color: 'warning', duration: 2500 });
    }
  };

  // Save / restore with every safety rule — shared with Home's round button.
  const drive = useDriveBackup((r) => {
    setEmail(linkedEmail());
    setLast(lastBackupAt());
    if (r) setRemote(r); else void loadRemote();
  });
  const busy = drive.busy;
  const doBackup = drive.backup;
  const doRestore = drive.restore;

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

  // Offer a restore once per account: this phone's book is empty and Drive
  // holds one. (A sync usually fills the book from the server first; the offer
  // is for when it cannot.)
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await loadRemote();
      if (!alive || r?.status !== 'ok' || r.summary.isEmpty) return;
      const userId = await ownerUserId();
      if (!alive || !userId || restoreOffered(userId) || !(await isLocalBookEmpty())) return;
      markRestoreOffered(userId);
      await presentOffer({
        header: 'نسخة في Google Drive',
        message: `الدفتر على هذا الجهاز فارغ، وفي Google Drive نسخة فيها: ${r.summary.sentence}. ` +
          'هل تريد استعادتها؟',
        buttons: [
          { text: 'لاحقاً', role: 'cancel' },
          { text: 'استعادة', handler: () => { void doRestore(); } },
        ],
      });
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRemote]);

  const stale = !!email && last > 0 && Date.now() - last > DAY_MS;
  const remoteLine = remote?.status === 'ok'
    ? `في Drive: ${remote.summary.sentence} — حُفظت ${stamp(remote.savedAt)}`
    : remote?.status === 'none' ? 'لا توجد نسخة في Google Drive بعد.' : null;

  return (
    <>
      <h2 className="settings-section">النسخ الاحتياطي</h2>
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
            {stale && ' — مضى أكثر من يوم.'}
            {remoteLine && `\n${remoteLine}`}
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
