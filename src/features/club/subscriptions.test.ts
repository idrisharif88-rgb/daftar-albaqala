import { describe, it, expect, vi } from 'vitest';

vi.mock('../../data/db', () => ({ getDB: vi.fn(), persist: vi.fn() }));
vi.mock('../../data/transactions', () => ({ addTransaction: vi.fn() }));

import { addDays, daysBetween, nextStart, statusOf, type ClubSubscription } from './subscriptions';

const sub = (start: string, end: string): ClubSubscription => ({
  id: 's', customer_id: 'c', package_name: 'شهري', days: 30, list_price: 1_000_000, price: 800_000,
  currency: 'YER', start_date: start, end_date: end, transaction_id: null, note: null,
  created_at: '', updated_at: '', deleted_at: null,
});

describe('club dates', () => {
  it('adds calendar days across months and years', () => {
    expect(addDays('2026-11-15', 29)).toBe('2026-12-14');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
  it('counts days between', () => {
    expect(daysBetween('2026-11-20', '2026-11-23')).toBe(3);
    expect(daysBetween('2026-11-23', '2026-11-20')).toBe(-3);
  });
  it('status: active, soon (≤3 days, incl. today), expired, none', () => {
    expect(statusOf(sub('2026-11-01', '2026-12-01'), '2026-11-20')).toEqual({ status: 'active', left: 11 });
    expect(statusOf(sub('2026-11-01', '2026-11-23'), '2026-11-20')).toEqual({ status: 'soon', left: 3 });
    expect(statusOf(sub('2026-11-01', '2026-11-20'), '2026-11-20')).toEqual({ status: 'soon', left: 0 });
    expect(statusOf(sub('2026-10-01', '2026-11-18'), '2026-11-20').status).toBe('expired');
    expect(statusOf(null).status).toBe('none');
  });
  it('a renewal starts the day after the current one ends, or today if it lapsed', () => {
    expect(nextStart(sub('2026-11-15', '2026-12-14'), '2026-11-20')).toBe('2026-12-15');
    expect(nextStart(sub('2026-10-01', '2026-10-30'), '2026-11-20')).toBe('2026-11-20');
    expect(nextStart(null, '2026-11-20')).toBe('2026-11-20');
  });
});
