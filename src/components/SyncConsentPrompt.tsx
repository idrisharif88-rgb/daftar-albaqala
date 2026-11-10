import { useCallback, useEffect, useRef } from 'react';
import { useIonToast } from '@ionic/react';
import { SYNC_REQUEST_EVENT, useAuth } from '../lib/auth';
import { runSync } from '../data/sync';
import { runPosSync } from '../features/pos/posSync';

// The question the developer cannot answer for the shopkeeper: «may your book
// be kept on the server?». Switching sync on in the Watcher only ASKS
// (sync_consent = 'pending'); the server refuses sync until this is answered
// yes. Shown while pending as a small top notification; Settings carries the
// same choice.
//
// Renders nothing.
export const SYNC_CONSENT_MESSAGE =
  'يطلب مطوّر التطبيق تفعيل مزامنة دفترك مع الخادم: تُحفظ نسخة من بياناتك على الخادم وتستطيع ' +
  'استعادتها على أي جهاز. لا يُفعَّل ذلك إلا بموافقتك، وتستطيع إيقافه متى شئت من الإعدادات.';

const SyncConsentPrompt: React.FC = () => {
  const { syncConsent, answerSyncConsent } = useAuth();
  const [presentToast, dismissToast] = useIonToast();
  const [presentResult] = useIonToast();
  const showing = useRef(false);

  // A small notification at the top — not a dialog in the middle of the
  // screen: «🔄 مزامنة دفترك مع الخادم؟» with a red ✕ and a green ✓. It stays
  // until answered; it comes back on a new request (live event) and on the
  // next launch, so a request is never lost (test 21: it used to be asked
  // once per launch only).
  const ask = useCallback(() => {
    if (showing.current) return;
    showing.current = true;
    const answer = (approve: boolean) => {
      answerSyncConsent(approve)
        .then(() => {
          if (approve) {
            void runSync({ force: true });
            void runPosSync();
          }
          void presentResult({
            message: approve ? '✓ تمت الموافقة' : '✕ تم الرفض',
            duration: 1600, position: 'top' as const, color: approve ? 'success' : 'medium',
          });
        })
        .catch(() => {
          void presentResult({ message: 'تعذّر إرسال الرد', duration: 2200, position: 'top' as const, color: 'danger' });
        });
    };
    void presentToast({
      message: '🔄 مزامنة دفترك مع الخادم؟',
      position: 'top' as const,
      duration: 0,
      cssClass: 'consent-toast',
      buttons: [
        { text: '✕', role: 'cancel' as const, htmlAttributes: { 'aria-label': 'رفض' }, handler: () => answer(false) },
        { text: '✓', htmlAttributes: { 'aria-label': 'موافق' }, handler: () => answer(true) },
      ],
      onDidDismiss: () => { showing.current = false; },
    });
  }, [answerSyncConsent, presentToast, presentResult]);

  useEffect(() => {
    if (syncConsent === 'pending') ask();
    else if (showing.current) void dismissToast(); // answered elsewhere (Settings) or withdrawn
  }, [syncConsent, ask, dismissToast]);

  // A new request from the Watcher while one is already pending: show it again.
  useEffect(() => {
    const onRequest = () => { if (syncConsent === 'pending') ask(); };
    window.addEventListener(SYNC_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(SYNC_REQUEST_EVENT, onRequest);
  }, [syncConsent, ask]);

  return null;
};

export default SyncConsentPrompt;
