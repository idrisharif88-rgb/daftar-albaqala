import { Capacitor, registerPlugin } from '@capacitor/core';
import { BiometricAuth, BiometryError, BiometryErrorType } from '@aparajita/capacitor-biometric-auth';
import { DEVICE_PREFS, prefChanged } from './prefKeys';

// Fingerprint unlock. The password still signs the account in — this guards a
// phone that is ALREADY signed in, which is the real risk for a ledger: the
// session lasts 30 days, and anyone holding the unlocked phone could read every
// customer's debts. Off by default; the owner turns it on in Settings. Synced
// with the account (lib/prefKeys.ts), so a new phone locks too — one that can
// check neither a finger nor a PIN is let through (BiometricGate).
//
// Fingerprint and the phone's PIN are two SEPARATE choices on Daftar's lock
// screen, the owner's call. The fingerprint prompt is therefore asked for the
// finger alone (allowDeviceCredential: false): on Android 10 that option does
// not add a PIN button to the sheet, it swaps the sheet for Settings' combined
// full-screen page, which covered the green lock screen. The PIN has its own
// button and its own check (verifyDevicePin, DevicePinPlugin.java).

const KEY = DEVICE_PREFS.biometric;

export function biometricEnabled(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setBiometricEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY);
  } catch { /* stays as it was */ }
  prefChanged('biometric');
}

/** What this phone can check: an enrolled fingerprint, its screen lock, both
 *  or neither. The lock screen offers a button for each one that exists. */
export async function unlockMethods(): Promise<{ finger: boolean; pin: boolean }> {
  if (!Capacitor.isNativePlatform()) return { finger: false, pin: false };
  try {
    const r = await BiometricAuth.checkBiometry();
    return { finger: r.isAvailable, pin: r.deviceIsSecure };
  } catch {
    return { finger: false, pin: false };
  }
}

/** Can this phone check anything at all — a fingerprint or its screen lock? */
export async function biometricAvailable(): Promise<boolean> {
  const m = await unlockMethods();
  return m.finger || m.pin;
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

// ---- The phone's PIN / pattern, on its own ----

interface DevicePinPlugin {
  confirm(): Promise<{ confirmed: boolean }>;
}
const DevicePin = registerPlugin<DevicePinPlugin>('DevicePin');

/** Ask for the phone's screen lock. Resolves on success; throws
 *  BiometricCancelled when the owner backs out. Android shows its own screen —
 *  full-screen on older Samsungs — and the app never sees the PIN itself. */
export async function verifyDevicePin(): Promise<void> {
  let confirmed = false;
  try {
    ({ confirmed } = await DevicePin.confirm());
  } catch (err) {
    throw new Error(err instanceof Error && err.message ? err.message : 'تعذّر التحقق من رمز الهاتف.');
  }
  if (!confirmed) throw new BiometricCancelled();
}
