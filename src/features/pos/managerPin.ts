// «رمز المدير» — checked on the staff member's phone, offline. The phone holds
// only 's1:<salt>:<sha256(salt + pin)>' from the server, never the code.

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const PIN_LENGTH = 6;

/** Does `pin` match the stored hash? False for anything malformed. */
export async function pinMatches(pin: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored || !/^\d{6}$/.test(pin)) return false;
  const [v, salt, digest] = stored.split(':');
  if (v !== 's1' || !salt || !digest) return false;
  try {
    return (await sha256Hex(salt + pin)) === digest;
  } catch {
    return false; // no WebCrypto (plain-http dev): never let it pass
  }
}

// Three wrong codes lock «تراجع» on THIS phone for five minutes. Kept in
// localStorage so leaving the screen or restarting the app does not reset it.
const FAIL_KEY = 'daftar.pin-fails';
export const MAX_PIN_FAILS = 3;
const LOCK_MS = 5 * 60 * 1000;

interface Fails { n: number; until: number }
function readFails(): Fails {
  try {
    const v = JSON.parse(localStorage.getItem(FAIL_KEY) ?? '') as Fails;
    return typeof v?.n === 'number' && typeof v?.until === 'number' ? v : { n: 0, until: 0 };
  } catch { return { n: 0, until: 0 }; }
}
function writeFails(f: Fails): void {
  try { localStorage.setItem(FAIL_KEY, JSON.stringify(f)); } catch { /* private mode: no lock memory */ }
}

/** Minutes left while «تراجع» is locked here; 0 = open. */
export function pinLockedMinutes(now = Date.now()): number {
  const f = readFails();
  return f.until > now ? Math.ceil((f.until - now) / 60000) : 0;
}

/** Record one attempt. Returns true once a wrong one has just locked it. */
export function notePinAttempt(ok: boolean, now = Date.now()): boolean {
  if (ok) { writeFails({ n: 0, until: 0 }); return false; }
  const f = readFails();
  const n = (f.until > now ? 0 : f.n) + 1;
  if (n >= MAX_PIN_FAILS) { writeFails({ n: 0, until: now + LOCK_MS }); return true; }
  writeFails({ n, until: 0 });
  return false;
}
