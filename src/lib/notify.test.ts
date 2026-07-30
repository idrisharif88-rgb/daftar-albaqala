import { describe, it, expect } from 'vitest';
import { buildMessage, toIntlDigits } from './notify';
import { toMinor } from '../data/money';
import { DEFAULT_RATES, type Rates } from '../data/currencies';

// These messages go out to real people over SMS and WhatsApp, and the one thing
// that must never happen is telling the wrong person that they owe the money.
// So the assertions here are on the whole text, line for line.

const RATES: Rates = { ...DEFAULT_RATES, SAR: 140, USD: 530, GOLD: 18000 };
const yer = (major: number) => ({ currency: 'YER' as const, minor: toMinor(major) });
const sar = (major: number) => ({ currency: 'SAR' as const, minor: toMinor(major) });

describe('buildMessage', () => {
  it('a debt on a زبون, in riyals', () => {
    const msg = buildMessage({
      senderName: 'بقالة الأمل',
      role: 'customer',
      type: 'debt',
      amount: toMinor(5000),
      currency: 'YER',
      balances: [yer(20000)],
      rates: RATES,
    });
    expect(msg).toBe(
      'بقالة الأمل\n' +
      'تسجيل دين 5,000 ريال يمني\n' +
      '\n' +
      'رصيدك الآن: 20,000 ريال يمني عليك\n' +
      'عشرون ألف ريال'
    );
  });

  // The owner's own case: he takes goods on credit from his grocer. That is
  // stored as a 'payment' (it lowers the signed balance) and must still read as
  // a debt being recorded, with the balance owed TO the grocer.
  it('goods taken on credit from a صاحب متجر read as a debt', () => {
    const msg = buildMessage({
      senderName: 'إدريس',
      role: 'supplier',
      type: 'payment',
      amount: toMinor(3000),
      currency: 'YER',
      balances: [yer(-8000)],
      rates: RATES,
    });
    expect(msg).toBe(
      'إدريس\n' +
      'تسجيل دين 3,000 ريال يمني\n' +
      '\n' +
      'رصيدك الآن: 8,000 ريال يمني لك\n' +
      'ثمانية آلاف ريال'
    );
  });

  it('a شريك is addressed directly — «أخذت منك», not «أخذت منه»', () => {
    const msg = buildMessage({
      senderName: 'إدريس',
      role: 'partner',
      type: 'payment',
      amount: toMinor(5000),
      currency: 'YER',
      balances: [yer(-5000)],
      rates: RATES,
    });
    expect(msg.split('\n')[1]).toBe('أخذت منك 5,000 ريال يمني');
    expect(msg).toContain('رصيدك الآن: 5,000 ريال يمني لك');
  });

  it('spells a foreign-currency entry out in riyals, with the rate', () => {
    const msg = buildMessage({
      senderName: 'بقالة الأمل',
      role: 'customer',
      type: 'debt',
      amount: toMinor(100),
      currency: 'SAR',
      balances: [yer(20000), sar(100)],
      rates: RATES,
    });
    expect(msg).toBe(
      'بقالة الأمل\n' +
      'تسجيل دين 100 ريال سعودي\n' +
      '≈ 14,000 ريال يمني (سعر الصرف 140)\n' +
      '\n' +
      '20,000 ريال يمني عليك\n' +
      '100 ريال سعودي عليك\n' +
      '≈ 14,000 ريال يمني\n' +
      'رصيدك الآن: 34,000 ريال يمني عليك\n' +
      'أربعة وثلاثون ألف ريال'
    );
  });

  // A single foreign balance needs no «≈» line of its own: the closing total is
  // already that number.
  it('does not repeat the conversion for a lone foreign balance', () => {
    const msg = buildMessage({
      senderName: '',
      role: 'customer',
      type: 'debt',
      amount: toMinor(100),
      currency: 'SAR',
      balances: [sar(100)],
      rates: RATES,
    });
    expect(msg).toBe(
      'تسجيل دين 100 ريال سعودي\n' +
      '≈ 14,000 ريال يمني (سعر الصرف 140)\n' +
      '\n' +
      '100 ريال سعودي عليك\n' +
      'رصيدك الآن: 14,000 ريال يمني عليك\n' +
      'أربعة عشر ألف ريال'
    );
  });

  it('omits the riyal total when no rate is set rather than inventing one', () => {
    const msg = buildMessage({
      senderName: 'بقالة الأمل',
      role: 'customer',
      type: 'debt',
      amount: toMinor(5),
      currency: 'GOLD',
      balances: [{ currency: 'GOLD', minor: toMinor(5) }],
      rates: DEFAULT_RATES, // nothing configured
    });
    expect(msg).toBe(
      'بقالة الأمل\n' +
      'تسجيل دين 5 جرام ذهب\n' +
      '\n' +
      'رصيدك الآن:\n' +
      '5 جرام ذهب عليك'
    );
  });

  it('marks a total that had to skip an unpriced currency', () => {
    const msg = buildMessage({
      senderName: '',
      role: 'customer',
      type: 'debt',
      amount: toMinor(1000),
      currency: 'YER',
      balances: [yer(1000), { currency: 'GOLD', minor: toMinor(2) }],
      rates: { ...DEFAULT_RATES, GOLD: 0 },
    });
    expect(msg).toContain('رصيدك الآن: 1,000 ريال يمني عليك (عدا ما لم يُحدَّد سعره)');
    expect(msg).toContain('ألف ريال');
  });

  it('says مسدد when nothing is outstanding, with no words line', () => {
    const msg = buildMessage({
      senderName: 'بقالة الأمل',
      role: 'customer',
      type: 'payment',
      amount: toMinor(5000),
      currency: 'YER',
      balances: [],
      rates: RATES,
    });
    expect(msg).toBe(
      'بقالة الأمل\n' +
      'تسديد دفعة 5,000 ريال يمني\n' +
      '\n' +
      'رصيدك الآن: مسدد'
    );
  });

  it('appends the note last, attributed to the sender', () => {
    const msg = buildMessage({
      senderName: 'بقالة الأمل',
      role: 'customer',
      type: 'debt',
      amount: toMinor(500),
      currency: 'YER',
      balances: [yer(500)],
      rates: RATES,
      note: 'كيس دقيق',
    });
    expect(msg.split('\n').pop()).toBe('ملاحظة من بقالة الأمل: كيس دقيق');
  });
});

describe('toIntlDigits', () => {
  it('normalises Yemeni numbers for wa.me', () => {
    expect(toIntlDigits('0771234567')).toBe('967771234567');
    expect(toIntlDigits('771234567')).toBe('967771234567');
    expect(toIntlDigits('+967 771-234-567')).toBe('967771234567');
    expect(toIntlDigits('00967771234567')).toBe('967771234567');
  });
});
