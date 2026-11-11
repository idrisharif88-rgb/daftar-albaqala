import { getDB } from './db';
import { getManyMeta, setMeta } from './meta';
import { getMultiDevice } from '../lib/storage';

// «عدة أجهزة» — one account on several phones (a grocer and his son, say).
// Each phone is asked once who uses it: a name and the last 3 digits of that
// person's own number. Every entry recorded on the phone then carries
// «الاسم · 727», and its invoice/notice numbers are «727-12», so two phones
// can never hand out the same number.
//
// Kept in app_meta: per phone, never synced, and wiped on an account switch
// (a new account asks again). Only used while the Watcher switch is on.
//
// The 3 digits are LOCKED once an entry carries them — they are part of every
// number this phone has issued. The name can still be corrected.

const NAME_KEY = 'device_user_name';
const CODE_KEY = 'device_user_code';

export interface DeviceUser { name: string; code: string }

export async function getDeviceUser(): Promise<DeviceUser | null> {
  const m = await getManyMeta([NAME_KEY, CODE_KEY]);
  const name = (m[NAME_KEY] ?? '').trim();
  const code = (m[CODE_KEY] ?? '').trim();
  return name && /^\d{3}$/.test(code) ? { name, code } : null;
}

/** «أحمد · 727» — what an entry is stamped with. */
export function formatDeviceUser(u: DeviceUser): string {
  return `${u.name} · ${u.code}`;
}

/** The stamp for a new entry, or null when the account is not multi-device. */
export async function deviceLabel(): Promise<string | null> {
  if (!getMultiDevice()) return null;
  const u = await getDeviceUser();
  return u ? formatDeviceUser(u) : null;
}

/** The prefix this phone's document numbers take («727»), or null. */
export async function deviceCode(): Promise<string | null> {
  if (!getMultiDevice()) return null;
  return (await getDeviceUser())?.code ?? null;
}

/** True once any entry carries this phone's digits — they can't change then. */
export async function isCodeLocked(): Promise<boolean> {
  const u = await getDeviceUser();
  if (!u) return false;
  const db = await getDB();
  const res = await db.query(
    `SELECT 1 FROM transactions WHERE recorded_by LIKE ? LIMIT 1`,
    [`% · ${u.code}`],
  );
  return (res.values ?? []).length > 0;
}

/** Validate + save. Throws an Arabic message the form can show. */
export async function saveDeviceUser(name: string, code: string): Promise<void> {
  const n = name.trim();
  const c = code.trim();
  if (!n) throw new Error('اكتب الاسم');
  if (n.length > 40) throw new Error('الاسم طويل');
  if (!/^\d{3}$/.test(c)) throw new Error('آخر 3 أرقام من رقمك');
  const current = await getDeviceUser();
  if (current && current.code !== c && await isCodeLocked()) {
    throw new Error('لا يمكن تغيير الأرقام بعد تسجيل حركة بها');
  }
  await setMeta(NAME_KEY, n);
  await setMeta(CODE_KEY, c);
}
