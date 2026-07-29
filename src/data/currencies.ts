import { formatMinor } from './money';

// The currencies a debt can be recorded in.
//
// DESIGN (decided with the owner): the NATIVE currency is the debt of record.
// A 100 SAR debt stays 100 SAR forever; a 5 gram gold debt stays 5 grams. We
// never convert on the way in and we never freeze a rate onto a transaction.
// The YER figure shown next to it is a *reference* recomputed at today's rate,
// which is why a customer's balance is a list (per currency), not one number.
//
// The alternative — converting to YER at entry — was rejected: it makes a gold
// debt stop tracking gold, and in a currency as unstable as the YER it quietly
// rewrites what someone owes.
//
// Gold is not money but it behaves like a unit here: an amount, a per-gram
// price in YER, and the same arithmetic. `isWeight` is the one place the
// difference matters (wording — "5 grams", not "5 gold").

export type CurrencyCode = 'YER' | 'SAR' | 'USD' | 'GOLD';

export interface CurrencyDef {
  code: CurrencyCode;
  /** Compact label for lists and tables — «100 ر.س». */
  shortAr: string;
  /** Full name for settings and pickers. */
  longAr: string;
  /** True for the base currency everything converts to. */
  isBase: boolean;
  /** Gold is grams of metal, not a currency. */
  isWeight: boolean;
}

// Display order — base first, then hard currencies, then gold.
export const CURRENCIES: CurrencyDef[] = [
  { code: 'YER',  shortAr: 'ريال',  longAr: 'ريال يمني',    isBase: true,  isWeight: false },
  { code: 'SAR',  shortAr: 'ر.س',   longAr: 'ريال سعودي',   isBase: false, isWeight: false },
  { code: 'USD',  shortAr: 'دولار', longAr: 'دولار أمريكي', isBase: false, isWeight: false },
  { code: 'GOLD', shortAr: 'جرام',  longAr: 'ذهب (جرام)',   isBase: false, isWeight: true  },
];

export const BASE_CURRENCY: CurrencyCode = 'YER';

const BY_CODE = new Map<string, CurrencyDef>(CURRENCIES.map((c) => [c.code, c]));

/** Currencies other than the base — the ones that need a user-supplied rate. */
export const CONVERTIBLE_CURRENCIES = CURRENCIES.filter((c) => !c.isBase);

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && BY_CODE.has(value);
}

/** Unknown codes fall back to the base rather than throwing — a row synced from
 *  a newer app version must never make an older one unusable. */
export function currencyDef(code: string): CurrencyDef {
  return BY_CODE.get(code) ?? BY_CODE.get(BASE_CURRENCY)!;
}

/** «1,500 ريال» / «100 ر.س» / «5 جرام». Amount is minor units. */
export function formatAmount(minor: number, code: string): string {
  return `${formatMinor(minor)} ${currencyDef(code).shortAr}`;
}

// ---- Rates ----
//
// A rate is "how many YER one unit is worth": SAR 140 means 1 SAR = 140 YER,
// GOLD 18000 means one gram = 18,000 YER. The base is always 1 by definition.
// 0 (or missing) means the owner hasn't set that rate yet — we then show the
// native amount alone rather than inventing a conversion.

export type Rates = Record<CurrencyCode, number>;

export const DEFAULT_RATES: Rates = { YER: 1, SAR: 0, USD: 0, GOLD: 0 };

export function hasRate(rates: Rates, code: string): boolean {
  const def = currencyDef(code);
  return def.isBase || rates[def.code] > 0;
}

/**
 * Convert minor units of `code` into minor units of the base currency.
 * Returns null when no rate is set, so callers show nothing instead of a zero
 * that reads like "this debt is worth nothing".
 */
export function toBaseMinor(minor: number, code: string, rates: Rates): number | null {
  const def = currencyDef(code);
  if (def.isBase) return minor;
  const rate = rates[def.code];
  if (!(rate > 0)) return null;
  return Math.round(minor * rate);
}

/** An amount owed in one currency. A contact's balance is a list of these —
 *  signed the same way the old single balance was: positive = they owe us. */
export interface CurrencyBalance {
  currency: CurrencyCode;
  minor: number;
}

/** Sum of several per-currency amounts in base minor units, skipping any
 *  currency with no rate. `complete` is false when something was skipped, so
 *  the UI can mark the total as partial instead of silently understating it. */
export function totalInBase(
  balances: CurrencyBalance[],
  rates: Rates,
): { minor: number; complete: boolean } {
  let minor = 0;
  let complete = true;
  for (const b of balances) {
    const converted = toBaseMinor(b.minor, b.currency, rates);
    if (converted === null) complete = false;
    else minor += converted;
  }
  return { minor, complete };
}

/**
 * «100 ر.س (≈ 14,000 ريال بسعر 140)» — the native amount with its YER value
 * spelled out, including the rate used. Showing the rate matters: the customer
 * receiving this message needs to see WHY the figure is what it is, and the
 * rate moves week to week.
 */
export function describeAmount(minor: number, code: string, rates: Rates): string {
  const native = formatAmount(minor, code);
  const conversion = describeConversion(minor, code, rates);
  return conversion ? `${native} ${conversion}` : native;
}

/**
 * Just the parenthetical — «(≈ 14,000 ريال سعر الصرف 140)» — for places that
 * already show the native amount and only want the conversion under it.
 * Returns null for the base currency, or when no rate is set.
 */
export function describeConversion(minor: number, code: string, rates: Rates): string | null {
  const def = currencyDef(code);
  if (def.isBase) return null;
  const converted = toBaseMinor(minor, code, rates);
  if (converted === null) return null;
  const baseShort = currencyDef(BASE_CURRENCY).shortAr;
  const rateLabel = def.isWeight ? 'سعر الجرام' : 'سعر الصرف';
  return `(≈ ${formatMinor(converted)} ${baseShort} ${rateLabel} ${formatRate(rates[def.code])})`;
}

/** Rates are prices, not money — show them plainly, up to 2 decimals. */
export function formatRate(rate: number): string {
  return rate.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
