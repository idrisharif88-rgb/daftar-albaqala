import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { pool } from '../db';

// Phone verification: the developer issues a 6-digit code from the Watcher and
// sends it himself (WhatsApp / SMS from his own phone); the user types it into
// the app. Proving the number reaches the person who registered it is what
// makes server sync safe to switch on for them.
//
// 🧩 Server concept: store a HASH of the code, never the code. A database dump
// then yields nothing usable. A 6-digit code has only a million values, so the
// hash alone would not resist guessing — the real protection is that it dies in
// 10 minutes and after 5 wrong tries, so an attacker gets 5 guesses in a million.

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;

/** A uniformly random 6-digit code, leading zeros kept ("004817"). */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Bound to the user, so the same code for two users never hashes the same. */
export function hashCode(userId: string, code: string): string {
  return createHash('sha256').update(`${userId}:${code}`).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Issue a fresh code for `userId` (replacing any earlier one). Null = no such user. */
export async function issueCode(userId: string, now = new Date()): Promise<
  { code: string; phone: string; expires_at: Date } | null
> {
  const [rows] = await pool.query('SELECT phone FROM users WHERE id = ?', [userId]);
  const user = (rows as Array<{ phone: string }>)[0];
  if (!user) return null;
  const code = generateCode();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  await pool.query(
    `UPDATE users SET verify_code_hash = ?, verify_code_expires_at = ?, verify_attempts = 0 WHERE id = ?`,
    [hashCode(userId, code), expiresAt, userId],
  );
  return { code, phone: user.phone, expires_at: expiresAt };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'already' | 'no_code' | 'expired' | 'locked' }
  | { ok: false; reason: 'wrong'; attempts_left: number };

/** Check a code the user typed. Spends one attempt when wrong. */
export async function verifyCode(userId: string, typed: unknown, now = new Date()): Promise<VerifyResult> {
  const [rows] = await pool.query(
    `SELECT phone_verified_at, verify_code_hash, verify_code_expires_at, verify_attempts
       FROM users WHERE id = ?`,
    [userId],
  );
  const u = (rows as Array<{
    phone_verified_at: Date | null; verify_code_hash: string | null;
    verify_code_expires_at: Date | null; verify_attempts: number;
  }>)[0];
  if (!u) return { ok: false, reason: 'no_code' };
  if (u.phone_verified_at) return { ok: false, reason: 'already' };
  if (!u.verify_code_hash || !u.verify_code_expires_at) return { ok: false, reason: 'no_code' };
  if (u.verify_attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'locked' };
  if (new Date(u.verify_code_expires_at).getTime() < now.getTime()) return { ok: false, reason: 'expired' };

  const code = String(typed ?? '').replace(/\D/g, '');
  if (code.length === 6 && sameHash(hashCode(userId, code), u.verify_code_hash)) {
    await pool.query(
      `UPDATE users SET phone_verified_at = UTC_TIMESTAMP(), verify_code_hash = NULL,
              verify_code_expires_at = NULL, verify_attempts = 0, updated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [userId],
    );
    return { ok: true };
  }
  // Count the miss atomically, so two parallel guesses cannot both see "4".
  await pool.query('UPDATE users SET verify_attempts = verify_attempts + 1 WHERE id = ?', [userId]);
  const left = MAX_ATTEMPTS - (u.verify_attempts + 1);
  return left > 0 ? { ok: false, reason: 'wrong', attempts_left: left } : { ok: false, reason: 'locked' };
}
