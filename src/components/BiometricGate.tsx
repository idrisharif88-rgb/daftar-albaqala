import { useCallback, useEffect, useRef, useState } from 'react';
import { IonButton, IonIcon } from '@ionic/react';
import { fingerPrint } from 'ionicons/icons';
import { App as CapacitorApp } from '@capacitor/app';
import { useAuth } from '../lib/auth';
import {
  biometricEnabled, biometricAvailable, verifyFinger, BiometricCancelled,
  consumeExpectedReturn,
} from '../lib/biometric';

// The lock screen over a signed-in app, when «قفل بالبصمة» is on.
//
// It asks at the two moments that matter: the moment the account is OPENED —
// on launch and right after a password login, because letting the first entry
// through and asking later would be guarding a door that was already open —
// and again on returning to the app after being away more than five minutes
// (the owner's figure: long enough that a quick glance at a message costs
// nothing, short enough that a phone left on a counter is not an open book).
//
// A return the app was EXPECTING never asks, however long it took: the app had
// handed over to WhatsApp, the messaging app, the printer, the file picker or
// Google itself, which is part of recording a debt, not reopening the app
// (see expectReturn in biometric.ts).
//
// It covers the screen rather than replacing the routes, so whatever was open
// (a half-typed entry, the send sheet) is still there once unlocked.
const AWAY_MS = 5 * 60_000;

const BiometricGate: React.FC = () => {
  const { isAuthenticated, logout } = useAuth();
  const [locked, setLocked] = useState(() => isAuthenticated && biometricEnabled());
  const [error, setError] = useState<string | null>(null);
  // True while Android's own fingerprint sheet is up. The lock screen then shows
  // nothing but its background: the sheet is already asking, and the owner saw
  // two things asking for the same finger at once. The lock's own text and
  // buttons appear only once the sheet is gone — he cancelled it, or it failed.
  const [asking, setAsking] = useState(false);
  const prompting = useRef(false);
  const leftAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    setAsking(true);
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
      setAsking(false);
    }
  }, []);

  // Lock on returning after five minutes away — unless the app itself sent the
  // owner to another app, which is let through however long it took.
  useEffect(() => {
    const handle = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) { leftAt.current = Date.now(); return; }
      const away = leftAt.current ? Date.now() - leftAt.current : 0;
      leftAt.current = null;
      const expected = consumeExpectedReturn();
      if (expected || away <= AWAY_MS) return;
      if (isAuthenticated && biometricEnabled()) setLocked(true);
    });
    return () => { void handle.then((h) => h.remove()); };
  }, [isAuthenticated]);

  // Signing out drops the lock. Signing IN raises it: the password alone is not
  // enough on a phone whose owner asked for a finger. Letting the first entry
  // through and asking only afterwards would be guarding a door that was
  // already open — anyone who knows the password would simply log in.
  // (It guards THIS phone. Someone who takes the password to another phone
  // meets no finger there, because the setting lives on the device.)
  useEffect(() => {
    if (!isAuthenticated) { setLocked(false); return; }
    if (biometricEnabled()) setLocked(true);
  }, [isAuthenticated]);

  // Ask for the finger as soon as the lock shows.
  useEffect(() => { if (locked) void unlock(); }, [locked, unlock]);

  if (!locked) return null;

  return (
    <div className="bio-gate" dir="rtl">
      {!asking && <div className="bio-gate__box">
        <IonIcon icon={fingerPrint} className="bio-gate__icon" />
        <h1>دفتر البقالة</h1>
        <p>الدفتر مقفل</p>
        {error && <p className="bio-gate__error">{error}</p>}
        <IonButton expand="block" onClick={() => void unlock()}>فتح بالبصمة</IonButton>
        <IonButton expand="block" fill="clear" onClick={logout}>
          الدخول بكلمة المرور
        </IonButton>
      </div>}
    </div>
  );
};

export default BiometricGate;
