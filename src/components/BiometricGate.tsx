import { useCallback, useEffect, useRef, useState } from 'react';
import { IonButton, IonIcon } from '@ionic/react';
import { fingerPrint } from 'ionicons/icons';
import { App as CapacitorApp } from '@capacitor/app';
import { useAuth } from '../lib/auth';
import {
  biometricEnabled, biometricAvailable, verifyFinger, BiometricCancelled,
} from '../lib/biometric';

// The lock screen over a signed-in app, when «قفل بالبصمة» is on. It locks on
// launch, and again after the app has been away for a minute — not on every
// return: recording a debt opens WhatsApp or the messaging app, and a finger
// demanded every time the owner comes back from sending a notice would be
// friction on the one thing he does most.
//
// It covers the screen rather than replacing the routes, so whatever was open
// (a half-typed entry, the send sheet) is still there once unlocked.
const AWAY_MS = 60_000;

const BiometricGate: React.FC = () => {
  const { isAuthenticated, logout } = useAuth();
  const [locked, setLocked] = useState(() => isAuthenticated && biometricEnabled());
  const [error, setError] = useState<string | null>(null);
  const prompting = useRef(false);
  const leftAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    setError(null);
    try {
      // A phone whose fingerprint and screen lock were both removed since the
      // lock was turned on can verify nothing — do not lock the owner out.
      if (!(await biometricAvailable())) { setLocked(false); return; }
      await verifyFinger();
      setLocked(false);
    } catch (err) {
      if (!(err instanceof BiometricCancelled)) {
        setError(err instanceof Error ? err.message : 'تعذّر التحقق من البصمة.');
      }
    } finally {
      prompting.current = false;
    }
  }, []);

  // Lock on resume after a minute away.
  useEffect(() => {
    const handle = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) { leftAt.current = Date.now(); return; }
      const away = leftAt.current ? Date.now() - leftAt.current : 0;
      leftAt.current = null;
      if (away > AWAY_MS && isAuthenticated && biometricEnabled()) setLocked(true);
    });
    return () => { void handle.then((h) => h.remove()); };
  }, [isAuthenticated]);

  // Signing out drops the lock; signing in does not raise it (the password was
  // just typed).
  useEffect(() => { if (!isAuthenticated) setLocked(false); }, [isAuthenticated]);

  // Ask for the finger as soon as the lock shows.
  useEffect(() => { if (locked) void unlock(); }, [locked, unlock]);

  if (!locked) return null;

  return (
    <div className="bio-gate" dir="rtl">
      <div className="bio-gate__box">
        <IonIcon icon={fingerPrint} className="bio-gate__icon" />
        <h1>دفتر البقالة</h1>
        <p>الدفتر مقفل</p>
        {error && <p className="bio-gate__error">{error}</p>}
        <IonButton expand="block" onClick={() => void unlock()}>فتح بالبصمة</IonButton>
        <IonButton expand="block" fill="clear" onClick={logout}>
          الدخول بكلمة المرور
        </IonButton>
      </div>
    </div>
  );
};

export default BiometricGate;
