import { getManyMeta, setManyMeta } from './meta';
import { FLAVOR } from '../flavors';

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
  // Whether to notify contacts (SMS + WhatsApp) when a debt/payment is recorded.
  // Default ON (preserves existing behavior); the owner can turn it off.
  notifyCustomers: boolean;
}

const DEFAULTS: Settings = {
  storeName: '', ownerName: '', notifyCustomers: true,
};

// app_meta keys
const KEYS: Record<keyof Settings, string> = {
  storeName: FLAVOR.nameKeys.store,
  ownerName: FLAVOR.nameKeys.owner,
  notifyCustomers: 'notify_customers',
};

export async function getSettings(): Promise<Settings> {
  const meta = await getManyMeta(Object.values(KEYS));
  return {
    storeName: meta[KEYS.storeName] ?? DEFAULTS.storeName,
    ownerName: meta[KEYS.ownerName] ?? DEFAULTS.ownerName,
    // Only an explicit '0' disables it; missing key = default ON.
    notifyCustomers: meta[KEYS.notifyCustomers] !== '0',
  };
}

export async function saveSettings(s: Settings): Promise<void> {
  await setManyMeta({
    [KEYS.storeName]: s.storeName.trim(),
    [KEYS.ownerName]: s.ownerName.trim(),
    [KEYS.notifyCustomers]: s.notifyCustomers ? '1' : '0',
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
