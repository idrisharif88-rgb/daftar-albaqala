import { Capacitor } from '@capacitor/core';
import { BiometricAuth, BiometryError, BiometryErrorType } from '@aparajita/capacitor-biometric-auth';

// Fingerprint unlock. The password still signs the account in — this guards a
// phone that is ALREADY signed in, which is the real risk for a ledger: the
// session lasts 30 days, and anyone holding the unlocked phone could read every
// customer's debts. Off by default; the owner turns it on in Settings, per
// device (localStorage, never synced — the finger is on this phone).
//
// The phone's own PIN/pattern is accepted too (allowDeviceCredential), so a
// cut finger or a wet hand never locks the owner out of his own book.

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
    return r.isAvailable || r.deviceIsSecure;
  } catch {
    return false;
  }
}

export class BiometricCancelled extends Error {}

/** Ask for the finger. Resolves on success; throws BiometricCancelled when the
 *  owner backs out, or an Error with an Arabic message for anything else. */
export async function verifyFinger(): Promise<void> {
  try {
    await BiometricAuth.authenticate({
      reason: 'افتح دفتر البقالة',
      androidTitle: 'دفتر البقالة',
      androidSubtitle: 'ضع إصبعك لفتح الدفتر',
      cancelTitle: 'إلغاء',
      allowDeviceCredential: true,
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
