import { getManyMeta, setManyMeta } from './meta';
import { DEFAULT_ROLE, isContactRole, type ContactRole } from './roles';

// App settings live in the `app_meta` key/value table (same store as the sync
// cursor and the exchange rates).
//
// NOTE: the old `currency` setting is gone. It used to be the single label
// stuck on every amount, which only worked while the app knew one currency.
// Now each transaction carries its own currency (see currencies.ts) and the
// base everything converts to is fixed at YER, so a global setting would be a
// second, contradictory source of truth. Rates live in rates.ts.

export interface Settings {
  storeName: string;
  // Who the book belongs to, for owners with no shop — the app is also used to
  // track personal debts, and a message has to be signed by SOMETHING. Only
  // used when there is no store name (see `messageSender`).
  ownerName: string;
  language: string;
  // Whether to notify contacts (SMS + WhatsApp) when a debt/payment is recorded.
  // Default ON (preserves existing behavior); the owner can turn it off.
  notifyCustomers: boolean;
  // What a newly added contact is assumed to be — a grocer adds customers all
  // day, someone tracking their own trade debts mostly adds suppliers.
  defaultRole: ContactRole;
}

const DEFAULTS: Settings = {
  storeName: '', ownerName: '', language: 'ar',
  notifyCustomers: true, defaultRole: DEFAULT_ROLE,
};

// app_meta keys
const KEYS: Record<keyof Settings, string> = {
  storeName: 'store_name',
  ownerName: 'owner_name',
  language: 'language',
  notifyCustomers: 'notify_customers',
  defaultRole: 'default_role',
};

export async function getSettings(): Promise<Settings> {
  const meta = await getManyMeta(Object.values(KEYS));
  const role = meta[KEYS.defaultRole];
  return {
    storeName: meta[KEYS.storeName] ?? DEFAULTS.storeName,
    ownerName: meta[KEYS.ownerName] ?? DEFAULTS.ownerName,
    language: meta[KEYS.language] ?? DEFAULTS.language,
    // Only an explicit '0' disables it; missing key = default ON.
    notifyCustomers: meta[KEYS.notifyCustomers] !== '0',
    defaultRole: isContactRole(role) ? role : DEFAULTS.defaultRole,
  };
}

export async function saveSettings(s: Settings): Promise<void> {
  await setManyMeta({
    [KEYS.storeName]: s.storeName.trim(),
    [KEYS.ownerName]: s.ownerName.trim(),
    [KEYS.language]: s.language,
    [KEYS.notifyCustomers]: s.notifyCustomers ? '1' : '0',
    [KEYS.defaultRole]: s.defaultRole,
  });
}

/**
 * The name the book signs itself with — on notifications, the PDF statement and
 * the Excel export. The shop comes first; someone tracking their own debts has
 * no shop, so their own name stands in. One helper so the three exports can't
 * each pick a different answer.
 */
export function messageSender(s: Pick<Settings, 'storeName' | 'ownerName'>): string {
  return s.storeName.trim() || s.ownerName.trim();
}
