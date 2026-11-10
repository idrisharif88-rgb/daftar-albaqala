import { createHash, randomBytes } from 'crypto';

// «رمز المدير» — a 4-digit code the shop owner sets; a staff member must type it
// to undo a sale. It is checked on the staff member's phone, OFFLINE, so the
// phone holds a salted SHA-256 of it, never the code itself. (Four digits can
// be guessed by anyone who holds the hash; it stops a casual undo at the till,
// which is what it is for — the opposite row is still in every report.)

export const PIN_RE = /^\d{4}$/;

export function hashPin(pin: string): string {
  const salt = randomBytes(8).toString('hex');
  const digest = createHash('sha256').update(salt + pin).digest('hex');
  return `s1:${salt}:${digest}`;
}
