import { getManyMeta, setManyMeta } from './meta';
import {
  CONVERTIBLE_CURRENCIES, DEFAULT_RATES, type CurrencyCode, type Rates,
} from './currencies';

// The YER value of one SAR / one USD / one gram of gold, as set by the owner.
//
// These are deliberately MANUAL. There is no rate feed to trust here: the app
// runs offline for days at a time, and in Yemen the rate that matters is the
// one in the owner's own market that day, not a published mid-market number.
// So the owner types it, we stamp when it was last touched, and the UI nudges
// when it's gone stale.
//
// Rates are NOT synced to the server. They are a property of the phone doing
// the reading, they change constantly, and syncing them would mean a stale
// device could overwrite a fresh rate — a bad trade for a number that is only
// ever used for display.

const RATE_KEY_PREFIX = 'rate_';
const UPDATED_KEY = 'rates_updated_at';

// A rate older than this is probably out of date — the UI says so rather than
// quietly presenting month-old conversions as current.
export const RATE_STALE_AFTER_DAYS = 7;

function rateKey(code: CurrencyCode): string {
  return `${RATE_KEY_PREFIX}${code}`;
}

export interface RatesState {
  rates: Rates;
  /** ISO timestamp of the last edit, or null if never set. */
  updatedAt: string | null;
}

export async function getRatesState(): Promise<RatesState> {
  const keys = [...CONVERTIBLE_CURRENCIES.map((c) => rateKey(c.code)), UPDATED_KEY];
  const meta = await getManyMeta(keys);
  const rates: Rates = { ...DEFAULT_RATES };
  for (const c of CONVERTIBLE_CURRENCIES) {
    const raw = meta[rateKey(c.code)];
    const parsed = raw === null ? NaN : Number(raw);
    rates[c.code] = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  return { rates, updatedAt: meta[UPDATED_KEY] };
}

export async function getRates(): Promise<Rates> {
  return (await getRatesState()).rates;
}

export async function saveRates(rates: Rates): Promise<void> {
  const entries: Record<string, string> = {};
  for (const c of CONVERTIBLE_CURRENCIES) {
    const value = rates[c.code];
    entries[rateKey(c.code)] = Number.isFinite(value) && value > 0 ? String(value) : '0';
  }
  entries[UPDATED_KEY] = new Date().toISOString();
  await setManyMeta(entries);
}

export function ratesAreStale(updatedAt: string | null): boolean {
  if (!updatedAt) return true;
  const age = Date.now() - new Date(updatedAt).getTime();
  return age > RATE_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

/** True once at least one non-base rate is set — until then the app can only
 *  show native amounts, and prompting for rates is worth doing. */
export function anyRateSet(rates: Rates): boolean {
  return CONVERTIBLE_CURRENCIES.some((c) => rates[c.code] > 0);
}
