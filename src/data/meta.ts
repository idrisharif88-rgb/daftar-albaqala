import { getDB, persist } from './db';

// `app_meta` is the small key/value table every bit of app state lives in: the
// sync cursor, the settings, the activation flag, the owning user id, the
// exchange rates. Four modules had each grown their own private copy of these
// two queries with subtly different persist() behaviour; this is the one copy.
//
// NOTE: `ensureLocalOwner` wipes this whole table when a different account logs
// in, so nothing that must survive an account switch belongs here — the schema
// version, for instance, lives in SQLite's own `user_version` instead.

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDB();
  const res = await db.query(`SELECT value FROM app_meta WHERE key = ?`, [key]);
  return ((res.values ?? [])[0]?.value as string) ?? null;
}

/** Several keys in one round-trip — cheaper than awaiting each in turn. */
export async function getManyMeta(keys: string[]): Promise<Record<string, string | null>> {
  if (keys.length === 0) return {};
  const db = await getDB();
  const placeholders = keys.map(() => '?').join(',');
  const res = await db.query(
    `SELECT key, value FROM app_meta WHERE key IN (${placeholders})`,
    keys,
  );
  const out: Record<string, string | null> = {};
  for (const key of keys) out[key] = null;
  for (const row of (res.values ?? []) as { key: string; value: string | null }[]) {
    out[row.key] = row.value;
  }
  return out;
}

/** Write without flushing — for callers batching several writes. */
export async function setMetaRaw(key: string, value: string): Promise<void> {
  const db = await getDB();
  await db.run(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

/** Write and flush to storage (a no-op flush on native — see db.persist). */
export async function setMeta(key: string, value: string): Promise<void> {
  await setMetaRaw(key, value);
  await persist();
}

export async function setManyMeta(entries: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(entries)) await setMetaRaw(key, value);
  await persist();
}
