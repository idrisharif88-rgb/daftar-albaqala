import { getDB, persist } from './db';

// App settings live in the `app_meta` key/value table (same store as the sync
// cursor). Defaults follow CLAUDE.md: currency YER, language ar. Store name is
// blank until the shopkeeper sets it (it's used in customer notifications).

export interface Settings {
  storeName: string;
  currency: string;
  language: string;
}

const DEFAULTS: Settings = { storeName: '', currency: 'YER', language: 'ar' };

// app_meta keys
const KEYS: Record<keyof Settings, string> = {
  storeName: 'store_name',
  currency: 'currency',
  language: 'language',
};

async function getMeta(key: string): Promise<string | null> {
  const db = await getDB();
  const res = await db.query(`SELECT value FROM app_meta WHERE key = ?`, [key]);
  return ((res.values ?? [])[0]?.value as string) ?? null;
}

async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDB();
  await db.run(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
  await persist();
}

export async function getSettings(): Promise<Settings> {
  const [storeName, currency, language] = await Promise.all([
    getMeta(KEYS.storeName),
    getMeta(KEYS.currency),
    getMeta(KEYS.language),
  ]);
  return {
    storeName: storeName ?? DEFAULTS.storeName,
    currency: currency ?? DEFAULTS.currency,
    language: language ?? DEFAULTS.language,
  };
}

export async function saveSettings(s: Settings): Promise<void> {
  await setMeta(KEYS.storeName, s.storeName.trim());
  await setMeta(KEYS.currency, s.currency);
  await setMeta(KEYS.language, s.language);
}
