import { verifyTotp } from './totp';

// Shared state for the admin door: login throttling and the single-use
// authenticator (TOTP) replay counter.
//
// The login route (routes/admin.ts) and the change gate
// (middleware/requireAdminCode.ts) draw from the SAME budget and the SAME
// counter, so a code used to log in cannot be replayed to authorise a change,
// and a code used for one change cannot authorise another. One code, one thing.

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

let failures: number[] = [];
let lockedUntil = 0;
let lastTotpStep = -1;

/** Tests only: forget failures, the lock and the last used code. */
export function resetAdminLoginState(): void {
  failures = [];
  lockedUntil = 0;
  lastTotpStep = -1;
}

export function isLocked(now = Date.now()): boolean {
  return now < lockedUntil;
}

export function recordFailure(now = Date.now()): void {
  failures = failures.filter((t) => now - t < WINDOW_MS);
  failures.push(now);
  if (failures.length >= MAX_FAILURES) {
    lockedUntil = now + LOCK_MS;
    failures = [];
  }
}

export function clearFailures(): void {
  failures = [];
}

/** The admin TOTP secret, or null when it is not configured. */
export function totpSecret(): string | null {
  return process.env.ADMIN_TOTP_SECRET ?? null;
}

/** Verifies a code against the admin secret WITHOUT consuming it. */
export function verifyCode(code: unknown, now = Date.now()): number | null {
  const secret = totpSecret();
  if (!secret) return null;
  return verifyTotp(secret, String(code ?? '').trim(), now);
}

/** Has this step (or an earlier one) already been accepted? */
export function isUsed(step: number): boolean {
  return step <= lastTotpStep;
}

/** Consume a step — any future code must come from a later step. */
export function markUsed(step: number): void {
  lastTotpStep = step;
}
