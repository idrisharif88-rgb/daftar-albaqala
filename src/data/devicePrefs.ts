import { getMeta, getStampedMeta, setMeta, setMetaRaw } from './meta';
import { persist } from './db';
import { DEVICE_PREFS, PREF_KEYS, announcePrefs, type PrefKey } from '../lib/prefKeys';
import { getPhone } from '../lib/storage';
import { isOwnerPhone } from '../config';

// The bridge between the preferences' live copy (localStorage, see
// lib/prefKeys.ts) and their synced copy (app_meta → user_settings).
//
//   phone edits  → pushPref:   localStorage → app_meta (stamped now) → sync
//   sync pulls   → adoptPrefs: app_meta → localStorage → screens re-read
//   every sync   → seedPrefs:  a value this phone has but app_meta lacks
//
// The seed matters twice: the first sync after this update (the values exist
// only in localStorage), and after an account switch (ensureLocalOwner wipes
// app_meta, localStorage survives). It is stamped at the epoch, so it fills an
// empty account but never beats a real edit made on another phone.

const EPOCH = '1970-01-01T00:00:00.000Z';

function read(key: PrefKey): string | null {
  try {
    const value = localStorage.getItem(DEVICE_PREFS[key]);
    // The fingerprint lock is stored as present/absent; on the wire it is 1/0,
    // so turning it OFF travels too.
    if (key === 'biometric') return value === '1' ? '1' : '0';
    return value;
  } catch {
    return null;
  }
}

function write(key: PrefKey, value: string): void {
  try {
    if (key === 'biometric' && value !== '1') localStorage.removeItem(DEVICE_PREFS[key]);
    else localStorage.setItem(DEVICE_PREFS[key], value);
  } catch { /* storage blocked: applies again on the next sync */ }
}

// The notebook is the owner's, and survives his switches to test accounts on
// purpose (data/updatesNotebook.ts). Seeding it into whatever account is signed
// in would copy his notes into that account — so it seeds only into his.
const maySeed = (key: PrefKey) => key !== 'updates_notebook' || isOwnerPhone(getPhone());

/** A preference changed on this phone: record it for the account and sync. */
export async function pushPref(key: PrefKey): Promise<void> {
  const value = read(key);
  if (value === null || value === (await getMeta(key))) return;
  await setMeta(key, value);
  const { runSync } = await import('./sync');
  void runSync();
}

/** Called before every push — see the header. */
export async function seedPrefs(): Promise<void> {
  const stamped = await getStampedMeta(PREF_KEYS);
  let wrote = false;
  for (const key of PREF_KEYS) {
    if (stamped[key].value !== null || !maySeed(key)) continue;
    const value = read(key);
    if (value === null) continue;
    await setMetaRaw(key, value, EPOCH);
    wrote = true;
  }
  if (wrote) await persist();
}

/** Synced values that just landed in app_meta: put them live. */
export async function adoptPrefs(keys: string[]): Promise<void> {
  const arrived = PREF_KEYS.filter((k) => keys.includes(k));
  if (arrived.length === 0) return;
  const stamped = await getStampedMeta(arrived);
  for (const key of arrived) {
    const value = stamped[key].value;
    if (value !== null) write(key, value);
  }
  announcePrefs(arrived);
}
