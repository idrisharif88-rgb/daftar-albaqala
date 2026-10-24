import { useCallback, useEffect, useRef, useState } from 'react';
import { IonButton, IonIcon } from '@ionic/react';
import { fingerPrint, keypadOutline } from 'ionicons/icons';
import { App as CapacitorApp } from '@capacitor/app';
import { useAuth } from '../lib/auth';
import {
  biometricEnabled, unlockMethods, verifyFinger, verifyDevicePin, BiometricCancelled,
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
  const { isAuthenticated } = useAuth();
  const [locked, setLocked] = useState(() => isAuthenticated && biometricEnabled());
  const [error, setError] = useState<string | null>(null);
  const [methods, setMethods] = useState({ finger: false, pin: false });
  const prompting = useRef(false);
  const leftAt = useRef<number | null>(null);

  // Two separate ways in, the owner's choice: the fingerprint (Android's small
  // sheet slides up over this green page) or the phone's PIN (Android's own
  // screen — full-screen on older Samsungs; an app cannot shrink it).
  const unlock = useCallback(async (how: 'finger' | 'pin') => {
    if (prompting.current) return;
    prompting.current = true;
    setError(null);
    try {
      const m = await unlockMethods();
      setMethods(m);
      // A phone whose fingerprint and screen lock were both removed since the
      // lock was turned on can verify nothing — do not lock the owner out.
      if (!m.finger && !m.pin) { setLocked(false); return; }
      if (how === 'finger' && m.finger) await verifyFinger();
      else await verifyDevicePin();
      setLocked(false);
    } catch (err) {
      if (!(err instanceof BiometricCancelled)) {
        setError(err instanceof Error ? err.message : 'تعذّر التحقق.');
      }
    } finally {
      prompting.current = false;
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

  // As soon as the lock shows, offer the fingerprint sheet over it — the
  // quickest way in. Cancelling it leaves this page with both buttons.
  useEffect(() => {
    if (!locked) return;
    void unlockMethods().then((m) => {
      setMethods(m);
      if (m.finger) void unlock('finger');
      else if (!m.pin) setLocked(false);
    });
  }, [locked, unlock]);

  if (!locked) return null;

  return (
    <div className="bio-gate" dir="rtl">
      <div className="bio-gate__box">
        <IonIcon icon={fingerPrint} className="bio-gate__icon" />
        <h1>دفتر البقالة</h1>
        <p>الدفتر مقفل</p>
        {error && <p className="bio-gate__error">{error}</p>}
        {methods.finger && (
          <IonButton expand="block" onClick={() => void unlock('finger')}>
            <IonIcon slot="start" icon={fingerPrint} />
            فتح بالبصمة
          </IonButton>
        )}
        {methods.pin && (
          <IonButton expand="block" fill="outline" onClick={() => void unlock('pin')}>
            <IonIcon slot="start" icon={keypadOutline} />
            فتح برمز الهاتف
          </IonButton>
        )}
      </div>
    </div>
  );
};

export default BiometricGate;
