import { formatMinor } from '../../data/money';

// The club's own messages (Phase 43; wording approved by the owner 2026-11-21).
// WhatsApp gets the emoji; the SMS carries the same lines without them.

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

/** «2026-12-20» → «20 ديسمبر 2026» (Latin digits, as everywhere in the app). */
export function arabicDate(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const riyal = (minor: number) => `${formatMinor(minor)} ريال يمني`;

function remainingLine(balanceAfter: number, label: string): string {
  return balanceAfter > 0 ? `${label}: ${riyal(balanceAfter)}` : 'تم سداد المبلغ كاملاً ✅';
}

function pack(lines: (string | null)[]): { whatsapp: string; sms: string } {
  const whatsapp = lines.filter((l) => l !== null).join('\n');
  // Same text, without emoji (they cost SMS characters and render poorly).
  const sms = whatsapp
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .split('\n').map((l) => l.trimEnd().replace(/^\s+/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
  return { whatsapp, sms };
}

export function subscriptionMessage(o: {
  club: string; packageName: string; price: number; listPrice: number; endDate: string; balanceAfter: number;
}): { whatsapp: string; sms: string } {
  const discount = o.listPrice > o.price ? ` (بعد خصم ${formatMinor(o.listPrice - o.price)})` : '';
  return pack([
    `🏋️ ${o.club}`,
    'تم تسجيل اشتراكك ✅',
    '',
    `الباقة: ${o.packageName}`,
    `المبلغ: ${riyal(o.price)}${discount}`,
    `اشتراكك ساري حتى ${arabicDate(o.endDate)}`,
    '',
    remainingLine(o.balanceAfter, 'المتبقي عليك'),
    'شكراً لاشتراكك 💪',
  ]);
}

export function paymentMessage(o: {
  club: string; amount: number; balanceAfter: number; endDate: string | null;
}): { whatsapp: string; sms: string } {
  return pack([
    `🏋️ ${o.club}`,
    '',
    `دفعت: ${riyal(o.amount)} ✅`,
    o.balanceAfter > 0 ? `المتبقي: ${riyal(o.balanceAfter)}` : 'تم سداد المبلغ كاملاً ✅',
    o.endDate ? `ينتهي اشتراكك في: ${arabicDate(o.endDate)}` : null,
    '',
    'شكراً لك',
  ]);
}

/** A reminder only — nothing is recorded (approved wording, 2026-11-21). */
export function reminderMessage(o: { club: string; endDate: string; expired: boolean }): { whatsapp: string; sms: string } {
  return pack(o.expired
    ? [`🏋️ ${o.club}`, '', `انتهى اشتراكك في: ${arabicDate(o.endDate)}`, 'يسعدنا تجديده لتعود معنا 💪']
    : [`🏋️ ${o.club}`, '', `اشتراكك ينتهي في: ${arabicDate(o.endDate)}`, 'نتمنى تجديده لتستمر معنا 💪']);
}
