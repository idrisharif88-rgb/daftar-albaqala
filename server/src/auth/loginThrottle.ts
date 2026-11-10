// Slows down password guessing on one login name (a phone number).
//
// After MAX_FAILURES wrong passwords for the same phone within WINDOW_MS, that
// phone is refused (429) until the window has passed since its first failure.
// A success clears it.
//
// Keyed by PHONE, not by IP: behind nginx every request arrives from
// 127.0.0.1, so a per-IP limit would lock every shop out at once (see
// routes/admin.ts). The cost of keying by phone is that a stranger can lock a
// cashier out for 15 minutes by guessing badly — accepted: that is noisy and
// short, a guessed password is neither.
//
// In memory, on purpose: one process, and a restart forgetting the counts
// only ever helps a legitimate user.

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED = 10_000; // a flood of random phones must not grow the map forever

interface Entry { count: number; since: number }

export function createLoginThrottle(now: () => number = Date.now) {
  const failures = new Map<string, Entry>();

  const current = (key: string): Entry | undefined => {
    const e = failures.get(key);
    if (e && now() - e.since >= WINDOW_MS) { failures.delete(key); return undefined; }
    return e;
  };

  return {
    /** True while this phone is locked out. */
    blocked(key: string): boolean {
      return (current(key)?.count ?? 0) >= MAX_FAILURES;
    },
    fail(key: string): void {
      const e = current(key);
      if (e) { e.count += 1; return; }
      if (failures.size >= MAX_TRACKED) {
        const oldest = failures.keys().next().value; // Map keeps insertion order
        if (oldest !== undefined) failures.delete(oldest);
      }
      failures.set(key, { count: 1, since: now() });
    },
    succeed(key: string): void {
      failures.delete(key);
    },
  };
}
