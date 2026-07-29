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
