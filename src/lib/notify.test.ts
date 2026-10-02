import { describe, it, expect } from 'vitest';
import {
  buildMessage, buildSmsMessage, printedBalanceLines, SMS_BUDGET, toIntlDigits, type InvoiceInfo,
} from './notify';
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

  // The invoice — the owner's paper book, spelled out for the recipient. The
  // third line names the SENDER by what he is to the reader: writing to a shop
  // he buys from, he is that shop's «الزبون».
  it('lays a basket out as an invoice', () => {
    const msg = buildMessage({
      senderName: 'إدريس',
      role: 'supplier',
      type: 'payment',
      amount: toMinor(3400),
      currency: 'YER',
      balances: [yer(-3400)],
      rates: RATES,
      // The note holds the same breakdown; it must not be printed twice.
      note: 'فاتورة رقم 12: جبن ×3، سكر ×2',
      invoice: {
        number: 12,
        issuedAt: new Date(2026, 7, 24, 18, 47),
        lines: [
          { name: 'جبن', qty: 3, unitPrice: toMinor(800), currency: 'YER', total: toMinor(2400) },
          { name: 'سكر', qty: 2, unitPrice: toMinor(500), currency: 'YER', total: toMinor(1000) },
        ],
      },
    });
    expect(msg).toBe(
      '🧾 فاتورة رقم 12\n' +
      '📅 الاثنين 2026-08-24 — 06:47 م\n' +
      'الزبون: إدريس\n' +
      '━━━━━━━━━━━━\n' +
      '1) جبن\n' +
      '   العدد 3 × 800 = 2,400 ريال\n' +
      '\n' +
      '2) سكر\n' +
      '   العدد 2 × 500 = 1,000 ريال\n' +
      '━━━━━━━━━━━━\n' +
      'إجمالي الفاتورة: 3,400 ريال يمني\n' +
      'الدفع: آجل (دين)\n' +
      '━━━━━━━━━━━━\n' +
      '💰 الرصيد الحالي: 3,400 ريال يمني\n' +
      'ثلاثة آلاف وأربعمائة ريال\n' +
      '(لكم عندنا)'
    );
  });

  // Writing to his own customer, the owner is «المتجر» — the mirror of the
  // case above. Naming the wrong side is how an invoice ends up saying the
  // sender is the one who owes.
  it('names the sender by what he is to THIS contact', () => {
    const msg = buildMessage({
      senderName: 'بقالة الأمل',
      role: 'customer',
      type: 'debt',
      amount: toMinor(500),
      currency: 'YER',
      balances: [yer(500)],
      rates: RATES,
      invoice: {
        number: 3,
        issuedAt: new Date(2026, 7, 24, 9, 51),
        lines: [
          { name: 'خبز', qty: 5, unitPrice: toMinor(100), currency: 'YER', total: toMinor(500) },
        ],
      },
    });
    expect(msg.split('\n')[2]).toBe('المتجر: بقالة الأمل');
    // A morning entry, and the balance points the other way.
    expect(msg.split('\n')[1]).toBe('📅 الاثنين 2026-08-24 — 09:51 ص');
    expect(msg.split('\n').pop()).toBe('(عليكم لنا)');
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

// ---- The SMS version ----
//
// Arabic is UCS-2: 67 characters per chained SMS part, and the owner's phone
// turns anything past seven parts into an MMS. He was deleting characters by
// hand to get back under that line, so these assert the budget itself, not just
// the wording.

const item = (name: string, qty: number, unit: number) => ({
  name, qty, unitPrice: toMinor(unit), currency: 'YER', total: toMinor(qty * unit),
});

function basket(count: number): InvoiceInfo {
  const source = [
    item('بطاطس نعمان أبو 50', 4, 50), item('بيض - حبة', 4, 50), item('جبن مزاز', 2, 100),
    item('روتي', 10, 20), item('زبادي كبير', 1, 300), item('شوكولاته أبو 50', 4, 50),
    item('عصير أبو 50', 2, 50), item('عصير ابو 100', 1, 100), item('كيك أبو 50', 4, 50),
  ];
  return {
    number: 47,
    issuedAt: new Date(2026, 8, 7, 14, 47),
    lines: Array.from({ length: count }, (_, i) => source[i % source.length]),
  };
}

const invoiceInput = (count: number) => ({
  senderName: 'إدريس أحمد',
  role: 'supplier' as const,
  type: 'payment' as const, // goods taken on credit — see the زبون/صاحب متجر cases above
  amount: basket(count).lines.reduce((sum, l) => sum + l.total, 0),
  currency: 'YER' as const,
  balances: [yer(-8950)],
  rates: RATES,
  invoice: basket(count),
});

describe('buildSmsMessage', () => {
  // The real invoice from the owner's screenshot (2026-09-07): nine items, and
  // the full layout came to 625 characters — ten parts, an MMS every time.
  it('fits the nine-item invoice that used to become an MMS', () => {
    const input = invoiceInput(9);
    expect(buildMessage(input).length).toBeGreaterThan(SMS_BUDGET);

    const sms = buildSmsMessage(input);
    expect(sms.length).toBeLessThanOrEqual(SMS_BUDGET);
    expect(sms).toBe(
      'فاتورة رقم 47 - 2026-09-07 02:47 م\n' +
      'الزبون: إدريس أحمد\n' +
      '1) بطاطس نعمان أبو 50: 4×50 = 200\n' +
      '2) بيض - حبة: 4×50 = 200\n' +
      '3) جبن مزاز: 2×100 = 200\n' +
      '4) روتي: 10×20 = 200\n' +
      '5) زبادي كبير: 1×300 = 300\n' +
      '6) شوكولاته أبو 50: 4×50 = 200\n' +
      '7) عصير أبو 50: 2×50 = 100\n' +
      '8) عصير ابو 100: 1×100 = 100\n' +
      '9) كيك أبو 50: 4×50 = 200\n' +
      'الإجمالي: 1,700 ريال يمني (دين)\n' +
      'الرصيد: 8,950 ريال يمني\n' +
      'ثمانية آلاف وتسعمائة وخمسون ريالاً\n' +
      '(لكم عندنا)'
    );
  });

  // The decoration is what the owner was deleting by hand.
  it('drops the rules and the emoji the full layout carries', () => {
    const sms = buildSmsMessage(invoiceInput(9));
    expect(sms).not.toContain('━');
    expect(sms).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    // …and the full layout keeps them, for WhatsApp and the printed receipt.
    expect(buildMessage(invoiceInput(9))).toContain('━');
  });

  it('leaves a short invoice alone', () => {
    const sms = buildSmsMessage(invoiceInput(2));
    expect(sms).toContain('2026-09-07'); // the date is the first thing to go
    expect(sms).toContain('الزبون: إدريس أحمد');
    expect(sms).toContain('ثمانية آلاف'); // …and the amount in letters the third
  });

  // Sheds one thing at a time, in the order the owner shed them himself.
  it('sheds the date, then the name, then the letters — before touching an item', () => {
    const sms = buildSmsMessage(invoiceInput(14));
    expect(sms.length).toBeLessThanOrEqual(SMS_BUDGET);
    expect(sms).not.toContain('2026-09-07');
    expect(sms).not.toContain('و1 أصناف'); // every item is still listed
    expect(sms.split('\n').filter((l) => /^\d+\) /.test(l))).toHaveLength(14);
  });

  // Only a basket that fits no other way loses items, and even then it loses as
  // few as possible and says how many are missing.
  it('keeps as many items as fit and names the remainder', () => {
    const sms = buildSmsMessage(invoiceInput(20));
    expect(sms.length).toBeLessThanOrEqual(SMS_BUDGET);
    const listed = sms.split('\n').filter((l) => /^\d+\) /.test(l)).length;
    expect(listed).toBeGreaterThan(10);
    expect(sms).toContain(`و${20 - listed} أصناف أخرى`);
    expect(sms).toContain('الإجمالي: 3,800 ريال يمني (دين)'); // the total is of ALL of them
  });

  it('a single entry keeps its own layout', () => {
    const input = {
      senderName: 'بقالة الأمل',
      role: 'customer',
      type: 'debt' as const,
      amount: toMinor(5000),
      currency: 'YER' as const,
      balances: [yer(20000)],
      rates: RATES,
    };
    expect(buildSmsMessage(input)).toBe(buildMessage(input));
  });

  it('trims a note long enough to overrun rather than let the phone cut it', () => {
    const sms = buildSmsMessage({
      senderName: 'بقالة الأمل',
      role: 'customer',
      type: 'debt',
      amount: toMinor(5000),
      currency: 'YER',
      balances: [yer(20000)],
      rates: RATES,
      note: 'ك'.repeat(600),
    });
    expect(sms.length).toBeLessThanOrEqual(SMS_BUDGET);
    expect(sms).toContain('…');
  });
});

// ---- The numbered movement notice ----
//
// The owner compared the two documents he sends the same shop: the invoice from
// the price list reads as a document, and the payment he makes against it read
// as a text message. A شريك had only the bare form at all. So a single entry
// now goes out with the same head, sections and closing as the invoice — for
// the two roles that send one (زبون waits until that side of the book is used).

const notice = { number: 5, issuedAt: new Date(2026, 8, 7, 14, 47) };

const single = (role: string, type: 'debt' | 'payment', note = '') => ({
  senderName: 'إدريس أحمد',
  role,
  type,
  amount: toMinor(5000),
  currency: 'YER' as const,
  balances: [yer(-20000)],
  rates: RATES,
  note,
  notice,
});

// The printed receipt carries the SMS's own balance block (2026-10-02), so
// the paper and the message can never state the balance differently.
describe('printedBalanceLines', () => {
  it('is the SMS balance block, word for word', () => {
    const input = invoiceInput(2);
    const lines = printedBalanceLines(input.balances, input.rates);
    expect(buildSmsMessage(input).endsWith(lines.join('\n'))).toBe(true);
    expect(lines[lines.length - 1]).toBe('(لكم عندنا)');
  });
});

describe('buildMessage — «إشعار حركة»', () => {
  it('goods taken from a شريك, with a note', () => {
    expect(buildMessage(single('partner', 'payment', 'كيس دقيق'))).toBe(
      '🧾 إشعار حركة رقم 5\n' +
      '📅 الاثنين 2026-09-07 — 02:47 م\n' +
      'الشريك: إدريس أحمد\n' +
      '━━━━━━━━━━━━\n' +
      'أخذت منك: 5,000 ريال يمني\n' +
      '━━━━━━━━━━━━\n' +
      'ملاحظة: كيس دقيق\n' +
      '━━━━━━━━━━━━\n' +
      '💰 الرصيد الحالي: 20,000 ريال يمني\n' +
      'عشرون ألف ريال\n' +
      '(لكم عندنا)'
    );
  });

  // The one the owner asked for by name: paying the shop he buys from. Stored
  // as a 'debt' — for a صاحب متجر that is the settling direction — and he is
  // «الزبون» to the person reading it.
  it('a payment to a صاحب متجر is the one that used to be bare', () => {
    const msg = buildMessage(single('supplier', 'debt'));
    expect(msg.split('\n')).toEqual([
      '🧾 إشعار حركة رقم 5',
      '📅 الاثنين 2026-09-07 — 02:47 م',
      'الزبون: إدريس أحمد',
      '━━━━━━━━━━━━',
      'تسديد دفعة: 5,000 ريال يمني',
      '━━━━━━━━━━━━',
      '💰 الرصيد الحالي: 20,000 ريال يمني',
      'عشرون ألف ريال',
      '(لكم عندنا)',
    ]);
  });

  it('the note section is absent when there is no note', () => {
    expect(buildMessage(single('partner', 'debt'))).not.toContain('ملاحظة');
  });

  // The wording still comes from the role, and it is written from the
  // recipient's side — the whole point of contactDirectionLabel.
  it('names the direction from the reader’s side, per role', () => {
    expect(buildMessage(single('partner', 'debt'))).toContain('دفعت لك: 5,000 ريال يمني');
    expect(buildMessage(single('supplier', 'payment'))).toContain('تسجيل دين: 5,000 ريال يمني');
  });

  // Left out on purpose: that side of the book is not in use yet, and its
  // wording should be shaped when it is, not guessed at now.
  it('a زبون keeps the bare layout', () => {
    const msg = buildMessage({ ...single('customer', 'debt'), notice: undefined });
    expect(msg).not.toContain('━');
    expect(msg.split('\n')[0]).toBe('إدريس أحمد');
  });

  it('the SMS form drops the rules and the emoji and still fits', () => {
    const sms = buildSmsMessage(single('partner', 'payment', 'كيس دقيق'));
    expect(sms.length).toBeLessThanOrEqual(SMS_BUDGET);
    expect(sms).toBe(
      'إشعار حركة رقم 5 - 2026-09-07 02:47 م\n' +
      'الشريك: إدريس أحمد\n' +
      'أخذت منك: 5,000 ريال يمني\n' +
      'ملاحظة: كيس دقيق\n' +
      'الرصيد: 20,000 ريال يمني\n' +
      'عشرون ألف ريال\n' +
      '(لكم عندنا)'
    );
  });

  it('trims an overlong note rather than let the phone cut the SMS', () => {
    const sms = buildSmsMessage(single('partner', 'payment', 'ك'.repeat(600)));
    expect(sms.length).toBeLessThanOrEqual(SMS_BUDGET);
    expect(sms).toContain('…');
    expect(sms).toContain('(لكم عندنا)'); // the closing survives the cut
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
