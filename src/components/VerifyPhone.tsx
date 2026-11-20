import { useEffect, useState } from 'react';
import {
  IonButton, IonContent, IonIcon, IonInput, IonItem, IonModal, IonNote, IonText, IonSpinner,
} from '@ionic/react';
import { shieldCheckmarkOutline } from 'ionicons/icons';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { toLatinDigits } from '../lib/digits';

// Phone verification: the developer sends a 6-digit code (WhatsApp / SMS); the
// owner types it here. Until then the book works as usual on the phone — only
// server sync waits for it (owner's decision, 2026-11-20).
//
// Opened from the banner on Home and from Settings → «الحساب», via one event,
// so there is a single dialog however many places offer it.

export const OPEN_VERIFY_PHONE_EVENT = 'daftar:open-verify-phone';
export const openVerifyPhone = () => window.dispatchEvent(new Event(OPEN_VERIFY_PHONE_EVENT));

function arabicError(err: unknown): string {
  if (!(err instanceof ApiError)) return 'تعذّر الاتصال. تحقق من الإنترنت وحاول مجدداً.';
  const body = (err.body ?? {}) as { attempts_left?: number };
  switch (err.status) {
    case 400:
      return typeof body.attempts_left === 'number'
        ? `الرمز غير صحيح. المحاولات المتبقية: ${body.attempts_left}`
        : 'الرمز غير صحيح.';
    case 410: return 'انتهت صلاحية الرمز. اطلب رمزاً جديداً.';
    case 404: return 'لم يُرسل إليك رمز بعد. تواصل معنا لطلبه.';
    case 409: return 'رقمك متحقق منه مسبقاً.';
    default: return 'تعذّر التحقق. حاول مجدداً.';
  }
}

/** The dialog. Mount once (App.tsx). */
export const VerifyPhoneModal: React.FC = () => {
  const { verifyPhone } = useAuth();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onOpen = () => { setCode(''); setError(null); setDone(false); setOpen(true); };
    window.addEventListener(OPEN_VERIFY_PHONE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_VERIFY_PHONE_EVENT, onOpen);
  }, []);

  const submit = async () => {
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyPhone(code);
      setDone(true);
      setTimeout(() => setOpen(false), 1400);
    } catch (err) {
      setError(arabicError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <IonModal isOpen={open} onDidDismiss={() => setOpen(false)} initialBreakpoint={0.6} breakpoints={[0, 0.6, 0.9]}>
      <IonContent className="ion-padding">
        <div className="verify-phone">
          <IonIcon icon={shieldCheckmarkOutline} className="verify-phone__icon" aria-hidden="true" />
          <h2>تأكيد رقم الهاتف</h2>
          {done ? (
            <IonText color="success"><p className="verify-phone__ok">✓ تم التحقق من رقمك</p></IonText>
          ) : (
            <>
              <IonText color="medium"><p>أدخل الرمز المكوّن من 6 أرقام الذي وصلك عبر واتساب أو رسالة نصية.</p></IonText>
              <IonItem lines="none" className="verify-phone__field">
                <IonInput
                  aria-label="رمز التحقق"
                  value={code}
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  maxlength={6}
                  placeholder="------"
                  className="verify-phone__input"
                  onIonInput={(e) => setCode(toLatinDigits(e.detail.value ?? '').replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                />
              </IonItem>
              {error && <IonNote color="danger" className="verify-phone__error">{error}</IonNote>}
              <IonButton expand="block" disabled={code.length !== 6 || busy} onClick={() => void submit()}>
                {busy ? <IonSpinner name="dots" /> : 'تأكيد'}
              </IonButton>
              <IonButton expand="block" fill="clear" color="medium" onClick={() => setOpen(false)}>لاحقاً</IonButton>
              <IonText color="medium"><p className="verify-phone__hint">🔒 لا تشارك هذا الرمز مع أحد.</p></IonText>
            </>
          )}
        </div>
      </IonContent>
    </IonModal>
  );
};

/** A slim notice for Home while the number is unconfirmed. Tap → the dialog. */
export const VerifyPhoneBanner: React.FC = () => {
  const { phoneVerified } = useAuth();
  if (phoneVerified !== false) return null;
  return (
    <button type="button" className="verify-banner" onClick={openVerifyPhone}>
      <IonIcon icon={shieldCheckmarkOutline} aria-hidden="true" />
      <span>أكّد رقم هاتفك — أدخل رمز التحقق</span>
    </button>
  );
};
