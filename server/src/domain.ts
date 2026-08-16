// The values the API accepts for the small closed sets in the schema.
//
// These MUST stay in step with the phone's `src/data/currencies.ts` and
// `src/data/roles.ts`. They were about to be duplicated per route file, which
// is how a currency ends up accepted by /transactions and rejected by
// /sync/push — the same record, two answers, depending on which door it came
// through. One definition, imported everywhere.

export const VALID_TXN_TYPES = new Set(['debt', 'payment']);

// YER = Yemeni riyal (the base), SAR, USD, and GOLD measured in grams.
export const VALID_CURRENCIES = new Set(['YER', 'SAR', 'USD', 'GOLD']);
export const DEFAULT_CURRENCY = 'YER';

// What a contact is to the owner of the book.
export const VALID_ROLES = new Set(['customer', 'supplier', 'partner']);
export const DEFAULT_ROLE = 'customer';

// Settings that belong to the ACCOUNT and therefore sync between the owner's
// devices — the name a notification is signed with, and the exchange rates the
// riyal reference figures are computed from.
//
// This is an ALLOWLIST, not a filter, and that is the whole point. The phone
// keeps these in `app_meta`, the same key/value table that also holds the sync
// cursor, the local activation flag and the id of the owning user. Syncing a
// cursor would let one phone rewind another's; `account_active` is the server's
// verdict to issue, not the client's to assert. So only names on this list may
// cross, in either direction.
export const SYNCABLE_SETTING_KEYS = new Set([
  'store_name',
  'owner_name',
  'language',
  'rate_SAR',
  'rate_USD',
  'rate_GOLD',
  'rates_updated_at',
]);

// Matches the VARCHAR(512) the column is declared as — checked here so an
// oversized value is REPORTED to the client rather than silently truncated by
// MySQL into a different value than the one the owner typed.
export const MAX_SETTING_VALUE_LENGTH = 512;
