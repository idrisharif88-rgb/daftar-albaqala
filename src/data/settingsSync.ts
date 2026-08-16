import { getStampedMeta, setMetaRaw } from './meta';

// The account settings that travel with the account instead of with the phone:
// the name a notification is signed with, and the exchange rates the riyal
// reference figures are computed from. Reinstall the app, or sign in on a
// second device, and these used to be gone — messages went out unsigned and
// every foreign-currency debt lost its riyal reference until the owner retyped
// the rates.
//
// This is an ALLOWLIST and it must stay one. `app_meta` is a single key/value
// table that ALSO holds the sync cursor, the local activation flag and the id
// of the owning user. Syncing a cursor would let one phone rewind another's;
// `account_active` is the server's verdict to issue, not the client's to claim.
// The server keeps the same list (`server/src/domain.ts`) and refuses anything
// else — so the two sides have to be changed together.

export const SYNCABLE_KEYS = [
  'store_name',
  'owner_name',
  'language',
  'rate_SAR',
  'rate_USD',
  'rate_GOLD',
  'rates_updated_at',
] as const;

/** One setting on the wire. `updated_at` is the phone clock that wrote it. */
export interface SettingRow {
  key: string;
  value: string | null;
  updated_at: string;
}

// A key never stamped (written before the column existed, or seeded on login)
// ranks below anything with a real timestamp.
const EPOCH = '1970-01-01T00:00:00.000Z';

// Compare as instants, not as text. The two sides do not agree on spelling:
// the phone writes `toISOString()`, while a MySQL DATETIME can come back as
// «2026-07-30 10:00:00». Both parse to the same number; only one of them sorts
// correctly as a string.
function millis(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Everything this device would like the account to know. Sent on every push:
 *  there are seven short strings, so there is nothing to gain by tracking which
 *  of them changed, and sending them all means a device whose earlier push was
 *  lost repairs itself on the next run. */
export async function getLocalSettings(): Promise<SettingRow[]> {
  const stamped = await getStampedMeta([...SYNCABLE_KEYS]);
  const rows: SettingRow[] = [];
  for (const key of SYNCABLE_KEYS) {
    const entry = stamped[key];
    // Never set on this phone — nothing to say about it. Staying silent lets
    // the other device's value stand; pushing an empty string would erase it.
    if (entry.value === null) continue;
    rows.push({ key, value: entry.value, updated_at: entry.updatedAt ?? EPOCH });
  }
  return rows;
}

/**
 * Merge what the server sent, key by key, last-write-wins.
 *
 * The comparison is per KEY, not per batch: the owner may have set the store
 * name on one phone and the dollar rate on the other, and both edits have to
 * survive. Returns how many keys the local copy actually changed, so the caller
 * can reload the screen only when something moved.
 */
export async function applyServerSettings(rows: SettingRow[]): Promise<number> {
  const incoming = rows.filter((r) => (SYNCABLE_KEYS as readonly string[]).includes(r.key));
  if (incoming.length === 0) return 0;

  const stamped = await getStampedMeta(incoming.map((r) => r.key));
  let changed = 0;
  for (const row of incoming) {
    if (row.value === null) continue;
    const local = stamped[row.key];
    const remoteAt = row.updated_at || EPOCH;
    // Unset here? Take it. Otherwise only a strictly newer edit wins — on a tie
    // the local copy stands, since rewriting an identical value would do
    // nothing but churn the timestamp.
    if (local?.value !== null && local?.value !== undefined &&
        millis(remoteAt) <= millis(local.updatedAt ?? EPOCH)) {
      continue;
    }
    // Keep the SERVER's timestamp rather than stamping `now`: this is not a
    // local edit, and re-dating it would let a value that has already lost an
    // argument win the next one.
    await setMetaRaw(row.key, row.value, remoteAt);
    changed++;
  }
  return changed;
}
