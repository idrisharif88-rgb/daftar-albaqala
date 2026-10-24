import { describe, it, expect } from 'vitest';
import { balancesUpTo, type Transaction } from './transactions';

const txn = (id: string, type: 'debt' | 'payment', amount: number, currency = 'YER'): Transaction => ({
  id, customer_id: 'c', type, amount, currency: currency as Transaction['currency'],
  note: null, occurred_at: '', created_at: '',
});

// A reprint must show the balance as it stood THEN, not today's.
describe('balancesUpTo', () => {
  // Newest first, as listTransactions returns it.
  const history = [
    txn('c3', 'payment', 300),
    txn('c2', 'debt', 500, 'SAR'),
    txn('c1', 'debt', 1000),
  ];

  it('counts the entry and everything before it, nothing after', () => {
    expect(balancesUpTo(history, 'c1')).toEqual([{ currency: 'YER', minor: 1000 }]);
    expect(balancesUpTo(history, 'c3')).toEqual([
      { currency: 'YER', minor: 700 },
      { currency: 'SAR', minor: 500 },
    ]);
  });

  it('is empty for an unknown id', () => {
    expect(balancesUpTo(history, 'nope')).toEqual([]);
  });
});
