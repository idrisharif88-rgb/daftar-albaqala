import { describe, expect, it } from 'vitest';
import { buildReminderMessage, owedText } from './reminders';
import { DEFAULT_RATES } from './currencies';

const R = { ...DEFAULT_RATES, SAR: 140 };

describe('automatic reminder text', () => {
  it('nothing owed → no reminder', () => {
    expect(owedText([], R)).toBeNull();
    expect(owedText([{ currency: 'YER', minor: -5000 }], R)).toBeNull();
  });
  it('one currency is stated in full', () => {
    expect(owedText([{ currency: 'SAR', minor: 10000 }], R)).toBe('100 ريال سعودي');
  });
  it('several currencies → the riyal total', () => {
    expect(owedText([{ currency: 'YER', minor: 100000 }, { currency: 'SAR', minor: 10000 }], R)).toBe('15,000 ريال يمني');
  });
  it('says who sent it, asks to pay, and that no one pressed send — in two SMS parts', () => {
    const m = buildReminderMessage('بقالة النور', '15,000 ريال يمني');
    expect(m).toContain('تذكير من بقالة النور:');
    expect(m).toContain('رصيدك المستحق: 15,000 ريال يمني');
    expect(m).toContain('السداد');
    expect(m).toContain('دون تدخل من أحد');
    expect(m.length).toBeLessThanOrEqual(134); // UCS-2: 2 × 67
  });
});
