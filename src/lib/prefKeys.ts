// Device preferences that follow the ACCOUNT, not the phone: the accent
// colour, the display size, the fingerprint lock and the owner's updates
// notebook. Reinstall the app or move to a new phone and they come back with
// the next sync.
//
// Each one lives in localStorage — read synchronously before the first paint,
// which the SQLite `app_meta` table cannot do — and is MIRRORED into app_meta
// under its sync key, where the account-settings sync (data/settingsSync.ts)
// carries it like the store name. data/devicePrefs.ts does the mirroring.
//
// No imports on purpose: appearance.tsx and appScale.ts load before the
// database and must stay that light.

/** sync key (app_meta + server user_settings) → localStorage key. */
export const DEVICE_PREFS = {
  ui_accent: 'daftar.accent',
  ui_scale: 'daftar.app-scale',
  biometric: 'daftar.biometric',
  updates_notebook: 'daftar-updates-notebook-v1',
} as const;

export type PrefKey = keyof typeof DEVICE_PREFS;
export const PREF_KEYS = Object.keys(DEVICE_PREFS) as PrefKey[];

const ARRIVED = 'daftar:prefs-arrived';

/** A synced value has just been written into localStorage — re-read it. */
export function announcePrefs(keys: PrefKey[]): void {
  if (keys.length) window.dispatchEvent(new CustomEvent(ARRIVED, { detail: keys }));
}

export function onPrefsArrived(listener: (keys: PrefKey[]) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<PrefKey[]>).detail);
  window.addEventListener(ARRIVED, handler);
  return () => window.removeEventListener(ARRIVED, handler);
}

/** Tell the account a preference changed on this phone. Loaded lazily so the
 *  callers above the database never pull it into the startup bundle. */
export function prefChanged(key: PrefKey): void {
  void import('../data/devicePrefs')
    .then((m) => m.pushPref(key))
    .catch(() => undefined); // the next sync's seed picks it up
}
