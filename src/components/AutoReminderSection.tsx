import { useCallback, useEffect, useState } from 'react';
import { IonItem, IonLabel, IonList, IonNote, IonText, IonToggle, useIonAlert } from '@ionic/react';
import { App as CapacitorApp } from '@capacitor/app';
import {
  autoSmsAvailable, autoSmsStatus, requestAutoSmsPermission, setAutoSmsEnabled,
} from '../data/reminders';

// Settings → «التذكير التلقائي». Rendered only in the direct build (outside
// Google Play), the one that carries SEND_SMS.
//
// The owner is told plainly, BEFORE Android's own permission dialog, what he is
// granting: the app will send SMS from his SIM, by itself, at his cost, to the
// contacts he marked as agreeing. Only then is the permission requested.

export const AUTO_SMS_DISCLOSURE =
  'سيرسل التطبيق رسائل تذكير SMS بالدين من شريحتك تلقائياً، دون أن تضغط إرسال، ' +
  'إلى الزبائن الذين وضعت لهم علامة «وافق على التذكير» فقط، وبالمدة التي اخترتها لكل زبون. ' +
  'تُرسل نهاراً فقط، وقد تُحتسب عليك رسوم الرسائل من شركة الاتصالات. ' +
  'سيطلب منك أندرويد الآن السماح بإرسال الرسائل. تستطيع الإيقاف متى شئت من هنا.';

const AutoReminderSection: React.FC = () => {
  const [on, setOn] = useState(false);
  const [permission, setPermission] = useState('prompt');
  const [presentAlert] = useIonAlert();

  const load = useCallback(async () => {
    const st = await autoSmsStatus();
    if (!st) return;
    setPermission(st.permission);
    setOn(st.enabled && st.permission === 'granted');
  }, []);

  useEffect(() => {
    void load();
    // Back from Android's settings, where the permission may have been revoked.
    const sub = CapacitorApp.addListener('resume', () => { void load(); });
    return () => { void sub.then((h) => h.remove()); };
  }, [load]);

  if (!autoSmsAvailable()) return null;

  const enable = () => {
    presentAlert({
      header: 'التذكير التلقائي',
      message: AUTO_SMS_DISCLOSURE,
      backdropDismiss: false,
      buttons: [
        { text: 'إلغاء', role: 'cancel', handler: () => { void load(); } },
        {
          text: 'موافق',
          handler: () => {
            void (async () => {
              const granted = await requestAutoSmsPermission();
              if (granted) await setAutoSmsEnabled(true);
              else {
                presentAlert({
                  header: 'لم يُسمح بإرسال الرسائل',
                  message: 'لن تُرسل التذكيرات. يمكنك السماح لاحقاً من إعدادات أندرويد ← التطبيقات ← الأذونات ← الرسائل.',
                  buttons: ['حسناً'],
                });
              }
              await load();
            })();
          },
        },
      ],
    });
  };

  const toggle = (want: boolean) => {
    if (want === on) return;
    if (want) enable();
    else void setAutoSmsEnabled(false).then(load);
  };

  return (
    <>
      <h2 className="settings-section">التذكير التلقائي</h2>
      <IonList>
        <IonItem>
          <IonToggle checked={on} onIonChange={(e) => toggle(e.detail.checked)}>
            <IonLabel>إرسال تذكير الدين برسالة SMS</IonLabel>
          </IonToggle>
        </IonItem>
      </IonList>
      <IonNote color="medium" className="ion-padding-start" style={{ display: 'block' }}>
        <IonText>
          {permission === 'denied' && !on
            ? 'إرسال الرسائل غير مسموح للتطبيق.'
            : 'المدة وموافقة الزبون تُحدَّد لكل زبون من صفحته (أيقونة حد الدين).'}
        </IonText>
      </IonNote>
    </>
  );
};

export default AutoReminderSection;
