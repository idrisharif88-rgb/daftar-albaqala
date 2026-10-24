import { Capacitor } from '@capacitor/core';
import { BiometricAuth, BiometryError, BiometryErrorType } from '@aparajita/capacitor-biometric-auth';

// Fingerprint unlock. The password still signs the account in — this guards a
// phone that is ALREADY signed in, which is the real risk for a ledger: the
// session lasts 30 days, and anyone holding the unlocked phone could read every
// customer's debts. Off by default; the owner turns it on in Settings, per
// device (localStorage, never synced — the finger is on this phone).
//
// The phone's PIN/pattern is deliberately NOT offered inside the prompt
// (allowDeviceCredential: false). On Android 10 and older that option does not
// add a button to the fingerprint sheet: it launches Settings' own
// ConfirmDeviceCredentialActivity, a separate full-screen grey page that covers
// the app's lock screen — the owner saw the green lock, then a blank page with
// a fingerprint on it. Without it, the fingerprint sheet slides up over the
// lock screen itself. A cut finger or a wet hand still never locks the owner
// out: the lock screen's «الدخول بكلمة المرور» is the fallback.

const KEY = 'daftar.biometric';

export function biometricEnabled(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setBiometricEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY);
  } catch { /* stays as it was */ }
}

/** Can this phone check a fingerprint (or at least its screen lock)? */
export async function biometricAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const r = await BiometricAuth.checkBiometry();
    // Only a phone with a fingerprint enrolled: the PIN is no longer accepted
    // in the prompt (see above), so a phone with just a screen lock would show
    // a prompt nobody could pass.
    return r.isAvailable;
  } catch {
    return false;
  }
}

export class BiometricCancelled extends Error {}

// ---- Leaving the app on purpose ----
//
// The lock asks for the finger whenever the app is reopened. But recording a
// debt OPENS another app — WhatsApp, the messaging app, the printer dialog, the
// file picker — and coming straight back from one of those is not "reopening";
// demanding a finger there would put a lock in the middle of the one thing the
// owner does most.
//
// So the app says, out loud, when it is handing over to another app, and the
// first return after that is let through. The flag lives in memory only: if
// Android kills the app while it is away, it comes back empty and the lock asks,
// which is the safe side to fail on.
let handedOverAt = 0;
const HAND_OFF_WINDOW_MS = 10 * 60_000;

/** Call right before opening another app. */
export function expectReturn(): void {
  handedOverAt = Date.now();
}

/** True once per hand-off: the return it was expecting. */
export function consumeExpectedReturn(): boolean {
  const expected = handedOverAt > 0 && Date.now() - handedOverAt < HAND_OFF_WINDOW_MS;
  handedOverAt = 0;
  return expected;
}

/** Ask for the finger. Resolves on success; throws BiometricCancelled when the
 *  owner backs out, or an Error with an Arabic message for anything else. */
export async function verifyFinger(): Promise<void> {
  try {
    await BiometricAuth.authenticate({
      reason: 'افتح دفتر البقالة',
      androidTitle: 'دفتر البقالة',
      androidSubtitle: 'ضع إصبعك لفتح الدفتر',
      cancelTitle: 'إلغاء',
      allowDeviceCredential: false,
      androidConfirmationRequired: false,
    });
  } catch (err) {
    if (err instanceof BiometryError) {
      if (err.code === BiometryErrorType.userCancel
        || err.code === BiometryErrorType.appCancel
        || err.code === BiometryErrorType.systemCancel) {
        throw new BiometricCancelled();
      }
      if (err.code === BiometryErrorType.biometryLockout) {
        throw new Error('محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً.');
      }
    }
    throw new Error('تعذّر التحقق من البصمة.');
  }
}
