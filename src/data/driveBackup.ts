import { getDB, persist } from './db';
import { getMeta } from './meta';
import { getLocalSettings, applyServerSettings, type SettingRow } from './settingsSync';
import { runSync } from './sync';
import { getAccessToken, findFile, saveFile, readFile } from '../lib/googleDrive';

// The book, backed up to the grocer's own Google Drive — an extra the owner
// grants per account from the Watcher (users.drive_backup, read via GET /me).
// Modelled on «خماسيات»: ONE file in the app's hidden Drive folder, replaced
// each time.
//
// It holds every contact, entry, price-list item and saved group, plus the
// synced settings — not the attachments (they are files, and they already sync
// to the server), not the sync cursor, not the login.
//
// Restoring MERGES, it never wipes: a row missing here is added; a contact,
// item or group newer in the backup replaces the local one; entries are
// append-only, so an entry is only ever added. Everything restored is marked
// unsynced, so the next sync carries it to the server too.

const FILE_NAME = 'daftar-backup.json';
const LAST_KEY = 'daftar.drive-last';
export const DAY_MS = 24 * 60 * 60 * 1000;

// Parents before children: an entry, an item or a group points at a contact.
const TABLES: { name: string; mutable: boolean }[] = [
  { name: 'customers', mutable: true },
  { name: 'items', mutable: true },
  { name: 'item_groups', mutable: true },
  { name: 'transactions', mutable: false },
];

type Row = Record<string, unknown>;

export interface BookBackup {
  app: 'daftar-albaqala';
  version: 1;
  userId: string;
  savedAt: number;
  tables: Record<string, Row[]>;
  settings: SettingRow[];
}

const ownerId = () => getMeta('owner_user_id');

export async function buildBackup(now = Date.now()): Promise<BookBackup> {
  const userId = await ownerId();
  if (!userId) throw new Error('سجّل الدخول أولاً');
  const db = await getDB();
  const tables: Record<string, Row[]> = {};
  for (const { name } of TABLES) {
    const res = await db.query(`SELECT * FROM ${name}`);
    // `synced` is this phone's bookkeeping, not part of the book.
    tables[name] = ((res.values ?? []) as Row[]).map((row) => {
      const copy = { ...row };
      delete copy.synced;
      return copy;
    });
  }
  return {
    app: 'daftar-albaqala', version: 1, userId, savedAt: now,
    tables, settings: await getLocalSettings(),
  };
}

const later = (a: unknown, b: unknown) =>
  new Date(String(a)).getTime() > new Date(String(b)).getTime();

/** Merge a backup into this phone's book. Returns how many rows it added or
 *  updated. Refuses a backup from another account. */
export async function applyBackup(backup: BookBackup): Promise<number> {
  if (backup?.app !== 'daftar-albaqala' || typeof backup.tables !== 'object' || !backup.tables) {
    throw new Error('ملف النسخة غير صالح');
  }
  if (backup.userId !== await ownerId()) {
    throw new Error('هذه النسخة تخص حساباً آخر');
  }
  const db = await getDB();
  let changed = 0;
  for (const { name, mutable } of TABLES) {
    // Only the columns this version of the app has — a backup from a newer or
    // older app may carry more or fewer.
    const info = await db.query(`PRAGMA table_info(${name})`);
    const cols = new Set(((info.values ?? []) as { name: string }[]).map((c) => c.name));
    for (const raw of backup.tables[name] ?? []) {
      if (typeof raw?.id !== 'string') continue;
      const row: Row = { ...Object.fromEntries(Object.entries(raw).filter(([k]) => cols.has(k))), synced: 0 };
      // Entries have no updated_at — they never change, only exist or not.
      const found = await db.query(
        `SELECT ${mutable ? 'updated_at' : 'id'} FROM ${name} WHERE id = ?`, [raw.id],
      );
      const existing = (found.values ?? [])[0] as Row | undefined;
      const keys = Object.keys(row);
      if (!existing) {
        await db.run(
          `INSERT INTO ${name} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
          keys.map((k) => row[k] ?? null),
        );
        changed++;
      } else if (mutable && later(row.updated_at, existing.updated_at)) {
        const sets = keys.filter((k) => k !== 'id');
        await db.run(
          `UPDATE ${name} SET ${sets.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
          [...sets.map((k) => row[k] ?? null), raw.id],
        );
        changed++;
      }
    }
  }
  if (Array.isArray(backup.settings)) changed += await applyServerSettings(backup.settings);
  await persist();
  void runSync(); // carry what came back to the server too
  return changed;
}

export const lastBackupAt = (): number => {
  try { return Number(localStorage.getItem(LAST_KEY)) || 0; } catch { return 0; }
};

// One backup at a time: the daily one and «نسخ الآن» together would upload the
// same file twice.
let running: Promise<number | null> | null = null;

/** Upload the book. Resolves the time it was saved, or null when there is no
 *  token and `interactive` was false. */
export function backupNow({ interactive }: { interactive: boolean }): Promise<number | null> {
  if (running) return running;
  running = (async () => {
    const token = await getAccessToken({ interactive });
    if (!token) return null;
    const backup = await buildBackup();
    await saveFile(token, FILE_NAME, JSON.stringify(backup));
    try { localStorage.setItem(LAST_KEY, String(backup.savedAt)); } catch { /* shown as never */ }
    return backup.savedAt;
  })().finally(() => { running = null; });
  return running;
}

/** When the copy on Drive was saved, or null if there is none. */
export async function remoteBackupAt(): Promise<number | null> {
  const token = await getAccessToken({ interactive: true });
  if (!token) return null;
  const file = await findFile(token, FILE_NAME);
  return file ? new Date(file.modifiedTime).getTime() : null;
}

/** Merge the Drive copy into this phone. Null when there is no copy. */
export async function restoreBackup(): Promise<number | null> {
  const token = await getAccessToken({ interactive: true });
  if (!token) return null;
  const file = await findFile(token, FILE_NAME);
  if (!file) return null;
  return applyBackup(JSON.parse(await readFile(token, file.id)) as BookBackup);
}

/** The daily backup: never opens Google's window — a valid or silently renewed
 *  token, else it waits for «نسخ الآن». */
export async function dailyBackupIfDue(now = Date.now()): Promise<number | null> {
  if (now - lastBackupAt() < DAY_MS) return null;
  return backupNow({ interactive: false });
}
