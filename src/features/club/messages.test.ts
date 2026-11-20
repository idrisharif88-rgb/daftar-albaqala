import { describe, it, expect } from 'vitest';
import { arabicDate, paymentMessage, subscriptionMessage } from './messages';

describe('club messages', () => {
  it('writes the date in words with Latin digits', () => {
    expect(arabicDate('2026-12-20')).toBe('20 ديسمبر 2026');
  });
  it('subscription message, approved wording', () => {
    const m = subscriptionMessage({ club: 'نادي الأبطال', packageName: 'شهري', price: 800000, listPrice: 1000000, endDate: '2026-12-20', balanceAfter: 800000 });
    expect(m.whatsapp).toBe([
      '🏋️ نادي الأبطال', 'تم تسجيل اشتراكك ✅', '', 'الباقة: شهري',
      'المبلغ: 8,000 ريال يمني (بعد خصم 2,000)', 'اشتراكك ساري حتى 20 ديسمبر 2026', '',
      'المتبقي عليك: 8,000 ريال يمني', 'شكراً لاشتراكك 💪',
    ].join('\n'));
    expect(m.sms).not.toMatch(/🏋|💪/);
    expect(m.sms).toContain('اشتراكك ساري حتى 20 ديسمبر 2026');
  });
  it('payment message; fully paid says so', () => {
    const m = paymentMessage({ club: 'نادي الأبطال', amount: 500000, balanceAfter: 300000, endDate: '2026-12-20' });
    expect(m.whatsapp).toContain('دفعت: 5,000 ريال يمني ✅');
    expect(m.whatsapp).toContain('المتبقي: 3,000 ريال يمني');
    expect(m.whatsapp).toContain('ينتهي اشتراكك في: 20 ديسمبر 2026');
    expect(paymentMessage({ club: 'ن', amount: 1, balanceAfter: 0, endDate: null }).whatsapp).toContain('تم سداد المبلغ كاملاً');
  });
});
