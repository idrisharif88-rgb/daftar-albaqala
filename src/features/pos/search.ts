import { toLatinDigits } from '../../lib/digits';

/** Does a product match what was typed? Case-insensitive, ignores spaces at
 *  the ends, and accepts Arabic-Indic digits — typing «٢٠٠» finds a code that
 *  contains 200. Matches the name or the barcode number. An empty query
 *  matches everything. */
export function matchesQuery(product: { name: string; code: string }, query: string): boolean {
  const q = toLatinDigits(query).trim().toLowerCase();
  if (!q) return true;
  return product.name.toLowerCase().includes(q) || product.code.includes(q);
}
