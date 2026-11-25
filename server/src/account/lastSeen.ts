import { pool } from '../db';

// «آخر نشاط» for the Watcher: the last time this account used the app.
// Stamped on every signed-in request, but written at most once a minute per
// account — the memory map skips the DB, the WHERE guards a restart.
// Fire-and-forget: a failed stamp must never fail the request it rides on.
const STEP_MS = 60_000;
const lastWrite = new Map<string, number>();

export function touchLastSeen(userId: string): void {
  const now = Date.now();
  const prev = lastWrite.get(userId);
  if (prev !== undefined && now - prev < STEP_MS) return;
  lastWrite.set(userId, now);
  pool
    .query(
      `UPDATE users SET last_seen_at = UTC_TIMESTAMP(3)
        WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE)`,
      [userId],
    )
    .catch(() => {
      lastWrite.delete(userId); // try again on the next request
    });
}

/** Tests only: forget the in-memory throttle. */
export function resetLastSeenThrottle(): void {
  lastWrite.clear();
}
