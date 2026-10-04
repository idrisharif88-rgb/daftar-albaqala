import { createHmac, randomBytes } from 'node:crypto';

// TOTP (RFC 6238) — the 6-digit code an authenticator app shows, changing
// every 30 seconds. Written out here instead of pulled in as a dependency:
// it is twenty lines of HMAC, and the admin login is the one place in this
// server where an extra package is extra attack surface.
//
// 🧩 Server concept: two-factor authentication. The password is something you
// KNOW; the authenticator is something you HAVE (the phone holding the shared
// secret). A leaked password alone no longer opens the door.

const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32 secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret, base32 — what you type into the authenticator app. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The code for one 30-second step. */
export function totpAt(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function currentStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

/**
 * Checks a code against the current step and one step either side (phone
 * clocks drift). Returns the step that matched, or null. The caller must
 * refuse a step it has already accepted — otherwise a code someone saw over
 * your shoulder works again for the rest of its minute.
 */
export function verifyTotp(secretB32: string, code: string, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const now = currentStep(nowMs);
  for (const step of [now - 1, now, now + 1]) {
    if (totpAt(secret, step) === code) return step;
  }
  return null;
}
