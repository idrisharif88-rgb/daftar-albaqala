import { Capacitor } from '@capacitor/core';
import { formatMinor } from '../data/money';
import {
  BASE_CURRENCY, baseValueLine, currencyDef, formatAmountFull, hasRate, totalInBase,
  type CurrencyBalance, type CurrencyCode, type Rates,
} from '../data/currencies';
import {
  contactBalanceLabel, contactBalancePhrase, contactDirectionLabel, roleDef,
} from '../data/roles';
import { tafqeetBaseMinor } from './tafqeet';
import type { TxnType } from '../data/transactions';
import type { InvoiceLine } from './receipt';

// Customer notifications: when the shopkeeper records a debt/payment we tell the
// customer. Two channels, both sent FROM the shopkeeper's own phone/number:
//   - SMS  : auto-sent (no tap) — Android only, via the cordova-sms-plugin.
//   - WhatsApp: opened on demand (a tap) via a wa.me deep link, pre-filled.
// Local Yemeni SIM-to-SIM SMS is cheap, so SMS is the default reach; WhatsApp is
// the richer option when the customer uses it.

const YEMEN_CC = '967';

/** An invoice, as the recipient is told about it — the paper invoice book the
 *  owner used to fill in by hand: a number, a date, and a line per item with
 *  its price, quantity and total. */
export interface InvoiceInfo {
  /** «رقم الفاتورة» — see data/invoiceNumber.ts. */
  number: number;
  issuedAt: Date;
  lines: InvoiceLine[];
}

// Normalize a stored local number to full international digits for wa.me, e.g.
// "07XXXXXXXX" / "7XXXXXXXX" -> "9677XXXXXXXX". Strips spaces/-/+ and a 00 or 0
// trunk prefix; leaves an already-967 number alone.
export function toIntlDigits(phone: string): string {
  let d = phone.replace(/[^\d]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith(YEMEN_CC)) return d;
  if (d.startsWith('0')) d = d.slice(1);
  return YEMEN_CC + d;
}

// ---- The invoice message ----
//
// A recorded basket goes out looking like the invoice it is — the layout the
// owner specified from his paper book (2026-08-24):
//
//   🧾 فاتورة رقم 12
//   📅 الاثنين 2026-08-24 — 09:51 ص
//   الزبون: إدريس أحمد
//   ━━━━━━━━━━━━
//   1) صحة شملان صغير
//      العدد 1 × 100 = 100 ريال
//
//   2) كيك أبو 50
//      العدد 2 × 50 = 100 ريال
//   ━━━━━━━━━━━━
//   إجمالي الفاتورة: 200 ريال يمني
//   الدفع: آجل (دين)
//   ━━━━━━━━━━━━
//   💰 الرصيد الحالي: 4,451 ريال يمني
//   أربعة آلاف وأربعمائة وواحد وخمسون ريالاً
//   (لكم عندنا)
//
// Two things are not obvious from looking at it:
//
//  - The third line names the SENDER by what he is to the reader — «الزبون»
//    writing to a shop he buys from, «المتجر» writing to his own customer (see
//    `senderLabelAr` in roles.ts). An invoice states which side of the counter
//    issued it, and this app is used from both.
//  - Nothing is aligned into columns and nothing tries to be. «جبن» and
//    «معكرونة» are different widths in a proportional font, so padding gives a
//    staggered edge rather than a table; the quantity line carries its own
//    label instead. The printed receipt does have real columns — it is drawn on
//    a canvas, where the font and the direction are ours to fix (receipt.ts).

const DAYS_AR = [
  'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت',
];

const RULE = '━━━━━━━━━━━━';

// «الاثنين 2026-08-24 — 09:51 ص».
//
// Built by hand rather than with `toLocaleString('ar')`, which returns
// Arabic-Indic digits wrapped in direction marks — those survive a screen but
// not an SMS gateway, and the app already writes fixed yyyy-mm-dd on the
// statement and in the spreadsheet.
function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const hour24 = d.getHours();
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const meridiem = hour24 < 12 ? 'ص' : 'م';
  return `${DAYS_AR[d.getDay()]} ${date} — ${p(hour12)}:${p(d.getMinutes())} ${meridiem}`;
}

function invoiceHeader(
  invoice: InvoiceInfo, senderName: string, role: string,
): string[] {
  const lines = [
    `🧾 فاتورة رقم ${invoice.number}`,
    `📅 ${stamp(invoice.issuedAt)}`,
  ];
  // An unnamed book has nothing to sign with — better a line missing than a
  // line reading «الزبون: ».
  if (senderName) lines.push(`${roleDef(role).senderLabelAr}: ${senderName}`);
  lines.push(RULE);
  return lines;
}

function invoiceItems(invoice: InvoiceInfo): string[] {
  const lines: string[] = [];
  invoice.lines.forEach((l, index) => {
    if (index > 0) lines.push('');
    lines.push(`${index + 1}) ${l.name}`);
    // The short currency name here, the full one on the total below: the reader
    // needs to be told once which riyal this is, not on every line.
    lines.push(
      `   العدد ${l.qty} × ${formatMinor(l.unitPrice)} = ` +
      `${formatMinor(l.total)} ${currencyDef(l.currency).shortAr}`,
    );
  });
  return lines;
}

// The Arabic message, one fact per line, in the order the recipient reads them:
//
//   بقالة الأمل                    ← who is writing
//   تسجيل دين 100 ر.س              ← what was recorded, in its own currency
//   ≈ 14,000 ريال (سعر الصرف 140)  ← and what that is worth in riyals
//                                  ← (blank)
//   100 ر.س عليك                   ← the balance, one line per currency
//   ≈ 14,000 ريال
//   20,000 ريال عليك
//   رصيدك الآن: 34,000 ريال عليك    ← the one figure that settles the argument
//   أربعة وثلاثون ألف ريال          ← the same figure in letters
//
// Three rules the layout is built on:
//  - The NATIVE currency is the debt of record (see currencies.ts). A 100 SAR
//    debt is spelled out in riyals as a courtesy, with the rate it was worked
//    out at, or the conversion looks arbitrary when the rate moves next week.
//  - The wording follows the contact's ROLE and is written from THEIR side:
//    a partner reads «أخذت منك», not «أخذت منه» (see roles.ts).
//  - The closing balance is repeated in words. A digit misread, an SMS mangled
//    on a bad line, a screenshot forwarded — the letters are the check.
export function buildMessage(opts: {
  /** Store name, or the owner's own name when there is no shop. */
  senderName: string;
  role: string; // what this contact is — decides the wording of the entry
  type: TxnType;
  amount: number; // minor units
  currency: CurrencyCode; // what the entry was recorded in
  balances: CurrencyBalance[]; // running balance per currency (+ = they owe us)
  rates: Rates;
  note?: string;
  /** Present when this entry is a basket recorded from the price list. Its
   *  breakdown then stands in for the note, which holds the same list. */
  invoice?: InvoiceInfo;
}): string {
  const { senderName, role, type, amount, currency, balances, rates, note, invoice } = opts;
  const sender = senderName.trim();

  // A basket is a different document from a single entry, so it gets its own
  // layout rather than a paragraph bolted onto this one.
  if (invoice) {
    return [
      ...invoiceHeader(invoice, sender, role),
      ...invoiceItems(invoice),
      RULE,
      `إجمالي الفاتورة: ${formatAmountFull(amount, currency)}`,
      'الدفع: آجل (دين)',
      RULE,
      ...invoiceBalance(balances, rates),
      // The note is NOT repeated: for an invoice it holds the same breakdown
      // the items above already spell out.
    ].join('\n');
  }

  const lines: string[] = [];

  if (sender) lines.push(sender);

  // What just happened, in the currency it was recorded in — then its riyal
  // value, with the rate, when it wasn't riyals.
  lines.push(`${contactDirectionLabel(role, type)} ${formatAmountFull(amount, currency)}`);
  const entryInBase = baseValueLine(amount, currency, rates);
  if (entryInBase) lines.push(entryInBase);

  lines.push(''); // the balance is a separate thought
  lines.push(...balanceLines(balances, rates));

  // An invoice's note IS its item list, already spelled out above — repeating
  // it would print the same basket twice.
  if (!invoice && note && note.trim()) {
    lines.push(sender ? `ملاحظة من ${sender}: ${note.trim()}` : `ملاحظة: ${note.trim()}`);
  }
  return lines.join('\n');
}

// The closing balance. Currencies never merge into one debt, so each gets its
// own line; the riyal total underneath is a convenience at today's rates and is
// the figure written out in letters.
function balanceLines(balances: CurrencyBalance[], rates: Rates): string[] {
  if (balances.length === 0) return ['رصيدك الآن: مسدد'];

  const lines: string[] = [];
  const convertible = balances.filter((b) => hasRate(rates, b.currency));
  // Without a single rate there is no honest total to close on, so the
  // per-currency lines have to stand on their own under a heading.
  const canTotal = convertible.length > 0;
  if (!canTotal) lines.push('رصيدك الآن:');

  // A lone riyal balance would just repeat the total line below it.
  const perCurrency = balances.length > 1 || balances[0].currency !== BASE_CURRENCY;
  if (perCurrency) {
    for (const b of balances) {
      lines.push(`${formatAmountFull(Math.abs(b.minor), b.currency)} ${contactBalanceLabel(b.minor)}`);
      // With one currency the total line below already gives the riyal value.
      if (balances.length > 1) {
        const inBase = baseValueLine(Math.abs(b.minor), b.currency, rates, false);
        if (inBase) lines.push(inBase);
      }
    }
  }

  if (canTotal) {
    const { minor: totalMinor, complete } = totalInBase(balances, rates);
    // Say so rather than quietly understating the debt when a rate is missing.
    const partial = complete ? '' : ' (عدا ما لم يُحدَّد سعره)';
    lines.push(
      `رصيدك الآن: ${formatAmountFull(Math.abs(totalMinor), BASE_CURRENCY)} ` +
      `${contactBalanceLabel(totalMinor)}${partial}`
    );
    lines.push(tafqeetBaseMinor(Math.abs(totalMinor)));
  }
  return lines;
}

// How the invoice closes: the running balance, the same figure in letters, and
// which way it points. The direction is a phrase on its own line — «(لكم
// عندنا)» — rather than a word tacked onto the amount, because on a document
// handed across a counter it reads as a statement of account instead of a
// demand.
function invoiceBalance(balances: CurrencyBalance[], rates: Rates): string[] {
  if (balances.length === 0) return ['💰 الحساب مسدد'];

  const lines: string[] = [];
  const convertible = balances.filter((b) => hasRate(rates, b.currency));
  const canTotal = convertible.length > 0;

  // More than one currency, or one that is not the riyal: each stands on its
  // own line first — a balance never merges across currencies (currencies.ts).
  const perCurrency = balances.length > 1 || balances[0].currency !== BASE_CURRENCY;
  if (perCurrency) {
    if (!canTotal) lines.push('💰 الرصيد الحالي:');
    for (const b of balances) {
      lines.push(`${formatAmountFull(Math.abs(b.minor), b.currency)} ${contactBalanceLabel(b.minor)}`);
      const inBase = baseValueLine(Math.abs(b.minor), b.currency, rates, balances.length === 1);
      if (inBase) lines.push(inBase);
    }
  }

  if (canTotal) {
    const { minor: totalMinor, complete } = totalInBase(balances, rates);
    // Say so rather than quietly understating the debt when a rate is missing.
    const partial = complete ? '' : ' (عدا ما لم يُحدَّد سعره)';
    const heading = perCurrency ? 'الرصيد الحالي' : '💰 الرصيد الحالي';
    lines.push(`${heading}: ${formatAmountFull(Math.abs(totalMinor), BASE_CURRENCY)}${partial}`);
    lines.push(tafqeetBaseMinor(Math.abs(totalMinor)));
    lines.push(`(${contactBalancePhrase(totalMinor)})`);
  }
  return lines;
}

// wa.me deep link that opens a chat to this customer with the message pre-filled.
export function whatsappUrl(phone: string, message: string): string {
  return `https://wa.me/${toIntlDigits(phone)}?text=${encodeURIComponent(message)}`;
}

// Open the WhatsApp chat (system handles the app/redirect).
export function openWhatsApp(phone: string, message: string): void {
  window.open(whatsappUrl(phone, message), '_blank');
}

// Open the phone's own SMS app with the number and the message already filled
// in. The grocer taps send.
//
// It used to send in the BACKGROUND, with no tap, through cordova-sms-plugin
// and the SEND_SMS permission. That permission had to go: Google Play restricts
// SEND_SMS to apps whose core purpose is messaging — the default SMS handler —
// and refuses everything else, so the app could never be published while it
// held it. There is no declaration form to fill in that changes this.
//
// The replacement needs NO permission at all. Handing the OS an `sms:` URI
// starts the user's own messaging app, pre-filled; the message is sent by the
// person, from the app they already trust, which is also why Play is happy with
// it. The cost is one extra tap per notice, and no way to confirm delivery.
//
// 🧩 Server concept: capability vs. delegation. Asking for SEND_SMS is asking
// to hold the capability yourself — the app can then message anyone, silently,
// forever. Firing an intent DELEGATES the act to a component the user controls,
// keeping the same outcome without ever holding the power. Least privilege is
// the same idea as `daftar_user` having DML but not DDL on the droplet: hold
// what the job needs, and no more.
//
// Android only. On web this is a no-op so the dev loop keeps working.
export function openSms(phone: string, message: string): boolean {
  if (Capacitor.getPlatform() !== 'android') return false;
  try {
    // `sms:<number>?body=<text>` is the standard URI form (RFC 5724) and is
    // what Android's messaging apps register for. Capacitor's WebView hands a
    // non-http scheme straight to the OS as an intent.
    window.open(`sms:${toIntlDigits(phone)}?body=${encodeURIComponent(message)}`, '_system');
    return true;
  } catch (err) {
    // A device with no messaging app at all. Not fatal: the entry is already
    // recorded, and WhatsApp is offered alongside this.
    console.warn('could not open the SMS app', err);
    return false;
  }
}
