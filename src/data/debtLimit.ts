import { projectBalances, type TxnType } from './transactions';
import { totalInBase, type CurrencyBalance, type CurrencyCode, type Rates } from './currencies';

// A contact's debt limit — the most the owner lets them owe, in riyals.
//
// Checked BEFORE an entry is recorded, against the balance as it would be
// after it (foreign amounts converted at today's rates; one with no rate set
// cannot be counted, so it is left out). Only an entry that RAISES what they
// owe is checked — a payment is always welcome.
//
//   ok   → record as usual
//   near → at NEAR_SHARE of the limit or more: a warning, the owner continues
//   over → past the limit: refused, unless the owner allows it this once

export const NEAR_SHARE = 0.8;

export type LimitState = 'ok' | 'near' | 'over';

export interface LimitCheck {
  state: LimitState;
  /** Riyal minor units owed after the entry. */
  after: number;
  /** Riyal minor units; null = no limit. */
  limit: number | null;
}

export function checkDebtLimit(
  limit: number | null,
  balances: CurrencyBalance[],
  type: TxnType,
  amount: number,
  currency: CurrencyCode,
  rates: Rates,
): LimitCheck {
  const before = totalInBase(balances, rates).minor;
  const after = totalInBase(projectBalances(balances, type, amount, currency), rates).minor;
  if (limit === null || limit <= 0 || after <= before) return { state: 'ok', after, limit };
  if (after > limit) return { state: 'over', after, limit };
  if (after >= limit * NEAR_SHARE) return { state: 'near', after, limit };
  return { state: 'ok', after, limit };
}
