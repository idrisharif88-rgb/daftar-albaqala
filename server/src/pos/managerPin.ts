import { createHash, randomBytes } from 'crypto';

// «رمز المدير» — a 6-digit code the shop owner sets; a staff member must type it
// to undo a sale. It is checked on the staff member's phone, OFFLINE, so the
// phone holds a salted SHA-256 of it, never the code itself. (Four digits can
// be brute-forced by anyone who holds the hash; it stops a casual undo at the till,
// which is what it is for — the opposite row is still in every report. The
// phone also locks «تراجع» after 3 wrong tries.)

export const PIN_LENGTH = 6;
export const PIN_RE = /^\d{6}$/;

/** A code too easy to guess: all one digit (111111) or a run (123456, 654321). */
export function weakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const d = [...pin].map(Number);
  const step = d[1] - d[0];
  return (step === 1 || step === -1) && d.every((x, i) => i === 0 || x - d[i - 1] === step);
}

export function hashPin(pin: string): string {
  const salt = randomBytes(8).toString('hex');
  const digest = createHash('sha256').update(salt + pin).digest('hex');
  return `s1:${salt}:${digest}`;
}
