import { useEffect, useRef } from 'react';
import { useIonAlert, useIonToast } from '@ionic/react';
import { useAuth } from '../lib/auth';
import { runSync } from '../data/sync';
import { runPosSync } from '../features/pos/posSync';

// The question the developer cannot answer for the shopkeeper: «may your book
// be kept on the server?». Switching sync on in the Watcher only ASKS
// (sync_consent = 'pending'); the server refuses sync until this is answered
// yes. Asked once per launch while pending — a «لاحقاً» leaves it pending, so
// it comes back next time, and Settings carries the same choice.
//
// Renders nothing.
export const SYNC_CONSENT_MESSAGE =
  'يطلب مطوّر التطبيق تفعيل مزامنة دفترك مع الخادم: تُحفظ نسخة من بياناتك على الخادم وتستطيع ' +
  'استعادتها على أي جهاز. لا يُفعَّل ذلك إلا بموافقتك، وتستطيع إيقافه متى شئت من الإعدادات.';

const SyncConsentPrompt: React.FC = () => {
  const { syncConsent, answerSyncConsent } = useAuth();
  const [presentAlert] = useIonAlert();
  const [presentToast] = useIonToast();
  const asked = useRef(false);

  useEffect(() => {
    if (syncConsent !== 'pending' || asked.current) return;
    asked.current = true;
    const answer = (approve: boolean) => {
      answerSyncConsent(approve)
        .then(() => {
          if (approve) {
            void runSync({ force: true });
            void runPosSync();
          }
          void presentToast({
            message: approve ? 'تم تفعيل المزامنة مع الخادم' : 'لن تُفعَّل المزامنة مع الخادم',
            duration: 2200, color: approve ? 'success' : 'medium',
          });
        })
        .catch(() => {
          asked.current = false; // the answer did not reach the server — ask again next time
          void presentToast({ message: 'تعذّر إرسال الرد. حاول من الإعدادات.', duration: 2600, color: 'danger' });
        });
    };
    presentAlert({
      header: 'طلب تفعيل المزامنة',
      message: SYNC_CONSENT_MESSAGE,
      backdropDismiss: false,
      buttons: [
        { text: 'لاحقاً', role: 'cancel' },
        { text: 'رفض', role: 'destructive', handler: () => answer(false) },
        { text: 'موافق', handler: () => answer(true) },
      ],
    });
  }, [syncConsent, answerSyncConsent, presentAlert, presentToast]);

  return null;
};

export default SyncConsentPrompt;
