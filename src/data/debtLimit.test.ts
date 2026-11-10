import { describe, expect, it } from 'vitest';
import { checkDebtLimit } from './debtLimit';
import { DEFAULT_RATES } from './currencies';

const R = { ...DEFAULT_RATES, SAR: 140 };
const yer = (major: number) => major * 100;

describe('checkDebtLimit', () => {
  it('no limit → always ok', () => {
    expect(checkDebtLimit(null, [], 'debt', yer(1e6), 'YER', R).state).toBe('ok');
  });
  it('below 80% ok, at 80% near, past the limit over', () => {
    const bal = [{ currency: 'YER' as const, minor: yer(30000) }];
    expect(checkDebtLimit(yer(50000), bal, 'debt', yer(5000), 'YER', R).state).toBe('ok');
    expect(checkDebtLimit(yer(50000), bal, 'debt', yer(10000), 'YER', R).state).toBe('near');
    expect(checkDebtLimit(yer(50000), bal, 'debt', yer(20000), 'YER', R).state).toBe('near');
    const over = checkDebtLimit(yer(50000), bal, 'debt', yer(20001), 'YER', R);
    expect(over.state).toBe('over');
    expect(over.after).toBe(yer(50001));
  });
  it('a payment is never refused, even over the limit', () => {
    const bal = [{ currency: 'YER' as const, minor: yer(90000) }];
    expect(checkDebtLimit(yer(50000), bal, 'payment', yer(1000), 'YER', R).state).toBe('ok');
  });
  it('صاحب متجر: «تسجيل دين» is a payment-type entry and is checked the other way', () => {
    // the owner already owes this shop 30,000 (balance −30,000)
    const bal = [{ currency: 'YER' as const, minor: -yer(30000) }];
    expect(checkDebtLimit(yer(50000), bal, 'payment', yer(10000), 'YER', R).state).toBe('near');
    const over = checkDebtLimit(yer(50000), bal, 'payment', yer(25000), 'YER', R);
    expect(over.state).toBe('over');
    expect(over.after).toBe(yer(55000));
    // paying the shop back is never refused
    expect(checkDebtLimit(yer(50000), bal, 'debt', yer(5000), 'YER', R).state).toBe('ok');
  });
  it('a foreign debt counts at today\'s rate', () => {
    const bal = [{ currency: 'YER' as const, minor: yer(40000) }];
    expect(checkDebtLimit(yer(50000), bal, 'debt', 100 * 100, 'SAR', R).state).toBe('over'); // +14,000
  });
  it('a foreign debt with no rate cannot be counted', () => {
    const bal = [{ currency: 'YER' as const, minor: yer(10000) }];
    expect(checkDebtLimit(yer(50000), bal, 'debt', 100 * 100, 'USD', R).state).toBe('ok');
  });
});
