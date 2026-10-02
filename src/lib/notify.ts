import { Capacitor, registerPlugin } from '@capacitor/core';
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
  /** «رقم الفاتورة» — see data/docNumber.ts. */
  number: number;
  issuedAt: Date;
  lines: InvoiceLine[];
}

/** A single movement, as the document it is sent out as: a number of its own
 *  series and the moment it was recorded (see data/docNumber.ts). */
export interface NoticeInfo {
  /** «رقم الإشعار» — counted separately from the invoice numbers. */
  number: number;
  issuedAt: Date;
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
export interface MessageInput {
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
  /** Present when this single entry goes out as a numbered «إشعار حركة» —
   *  which roles those are is `usesMovementNotice` in roles.ts. */
  notice?: NoticeInfo;
}

/** `words` is the تفقيط line; only the SMS ladder ever turns it off. */
export function buildMessage(opts: MessageInput, words = true): string {
  const {
    senderName, role, type, amount, currency, balances, rates, note, invoice, notice,
  } = opts;
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

  // A single movement, sent as the document the owner asked for: the same head,
  // sections and closing as the invoice, around one entry instead of a basket.
  if (notice) {
    return [
      `🧾 إشعار حركة رقم ${notice.number}`,
      `📅 ${stamp(notice.issuedAt)}`,
      ...(sender ? [`${roleDef(role).senderLabelAr}: ${sender}`] : []),
      RULE,
      ...entryLines(role, type, amount, currency, rates),
      ...(note && note.trim() ? [RULE, `ملاحظة: ${note.trim()}`] : []),
      RULE,
      ...invoiceBalance(balances, rates),
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
  lines.push(...balanceLines(balances, rates, words));

  // An invoice's note IS its item list, already spelled out above — repeating
  // it would print the same basket twice.
  if (!invoice && note && note.trim()) {
    lines.push(sender ? `ملاحظة من ${sender}: ${note.trim()}` : `ملاحظة: ${note.trim()}`);
  }
  return lines.join('\n');
}

// What was recorded, in the currency it was recorded in, and what that is worth
// in riyals when it was not riyals — with the rate it was worked out at, or the
// conversion looks arbitrary when the rate moves next week.
function entryLines(
  role: string, type: TxnType, amount: number, currency: CurrencyCode, rates: Rates,
): string[] {
  const lines = [`${contactDirectionLabel(role, type)}: ${formatAmountFull(amount, currency)}`];
  const inBase = baseValueLine(amount, currency, rates);
  if (inBase) lines.push(inBase);
  return lines;
}

// The closing balance. Currencies never merge into one debt, so each gets its
// own line; the riyal total underneath is a convenience at today's rates and is
// the figure written out in letters.
function balanceLines(balances: CurrencyBalance[], rates: Rates, words = true): string[] {
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
    if (words) lines.push(tafqeetBaseMinor(Math.abs(totalMinor)));
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

// ---- The SMS version of the same message ----
//
// A phone turns a long SMS into an MMS, and the owner will not send those: the
// recipient has to have data on to fetch one, it can arrive as an unreadable
// attachment, and it costs more. So he was deleting the message by hand,
// character by character, until his phone flipped the little counter back to
// SMS — losing the date, his own name and the labels every time.
//
// The budget is measurable. Arabic is outside GSM-7, so an SMS is encoded
// UCS-2: 70 characters alone, 67 per part once it is chained across several.
// The owner's phone converts above SEVEN parts, and the message he pared down
// by hand came to 468 characters — one under 7 × 67 = 469. That is the ceiling.
//
// WhatsApp has no such limit, so this layout is for SMS ONLY; buildMessage
// still writes the full invoice for WhatsApp and the printed receipt.
//
// What gets cut, and in what order, is taken from what the owner cut himself:
// he dropped the date, his name, the labels and the amount-in-letters, and kept
// every item line, the total and the balance. So the ladder below sheds the
// same things in the same order, and only as far as it must — a five-item
// invoice keeps everything.

/** 7 SMS parts × 67 UCS-2 characters. Above this the phone sends an MMS. */
export const SMS_BUDGET = 469;

/** The trim levels, in the order the owner himself cut them. */
const MAX_TRIM = 4;

// «2026-09-07 02:47 م» — the weekday and the long dash of the full layout cost
// ~10 characters that the date itself does not need.
function compactStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(h12)}:${p(d.getMinutes())} ${h24 < 12 ? 'ص' : 'م'}`;
}

// The closing balance, stripped to the figures. No emoji, and no per-currency
// ≈-in-riyals line: the riyal total is right underneath it.
function compactBalance(
  balances: CurrencyBalance[], rates: Rates, words: boolean,
): string[] {
  if (balances.length === 0) return ['الحساب مسدد'];

  const lines: string[] = [];
  const canTotal = balances.some((b) => hasRate(rates, b.currency));
  const perCurrency = balances.length > 1 || balances[0].currency !== BASE_CURRENCY;
  if (perCurrency) {
    if (!canTotal) lines.push('الرصيد:');
    for (const b of balances) {
      lines.push(
        `${formatAmountFull(Math.abs(b.minor), b.currency)} ${contactBalanceLabel(b.minor)}`,
      );
    }
  }
  if (canTotal) {
    const { minor, complete } = totalInBase(balances, rates);
    const partial = complete ? '' : ' (عدا ما لم يُحدَّد سعره)';
    lines.push(`الرصيد: ${formatAmountFull(Math.abs(minor), BASE_CURRENCY)}${partial}`);
    if (words) lines.push(tafqeetBaseMinor(Math.abs(minor)));
    lines.push(`(${contactBalancePhrase(minor)})`);
  }
  return lines;
}

// One line per item instead of three: no separator rules, no emoji, no blank
// line between items, and the currency named once on the total rather than on
// every row. Same facts, a little over half the characters.
//
//   فاتورة رقم 47 - 2026-09-07 02:47 م
//   الزبون: إدريس أحمد
//   1) بطاطس نعمان أبو 50: 4×50 = 200
//   2) بيض - حبة: 4×50 = 200
//   الإجمالي: 1,700 ريال يمني (دين)
//   الرصيد: 8,950 ريال يمني
//   ثمانية آلاف وتسعمائة وخمسون ريالاً
//   (لكم عندنا)
function compactInvoice(o: MessageInput, invoice: InvoiceInfo, level: number): string {
  const lines: string[] = [];
  const head = `فاتورة رقم ${invoice.number}`;
  lines.push(level >= 1 ? head : `${head} - ${compactStamp(invoice.issuedAt)}`);

  const sender = o.senderName.trim();
  if (level < 2 && sender) lines.push(`${roleDef(o.role).senderLabelAr}: ${sender}`);

  const items = invoice.lines.map(
    (l, i) => `${i + 1}) ${l.name}: ${l.qty}×${formatMinor(l.unitPrice)} = ${formatMinor(l.total)}`,
  );
  const foot = [
    `الإجمالي: ${formatAmountFull(o.amount, o.currency)} (دين)`,
    ...compactBalance(o.balances, o.rates, level < 3),
  ];

  if (level < 4) return [...lines, ...items, ...foot].join('\n');

  // The last resort: a basket so long that nothing above fits it. Rather than
  // drop the list wholesale, keep as many items as the budget holds and say how
  // many are missing — a reader who can check most of the invoice against what
  // he received is better served than one handed only a total. The full
  // breakdown is still on the entry, the statement and the printed receipt.
  const kept: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const left = items.length - i - 1;
    const tail = left > 0 ? [remainingItemsAr(left)] : [];
    if ([...lines, ...kept, items[i], ...tail, ...foot].join('\n').length > SMS_BUDGET) break;
    kept.push(items[i]);
  }
  const left = items.length - kept.length;
  return [...lines, ...kept, ...(left > 0 ? [remainingItemsAr(left)] : []), ...foot].join('\n');
}

/**
 * The balance block exactly as the SMS states it — «الرصيد: …», the amount in
 * words, «(لكم عندنا)» — for the printed receipt, so paper and message agree.
 * `balances` must already include the entry being printed.
 */
export function printedBalanceLines(balances: CurrencyBalance[], rates: Rates): string[] {
  return compactBalance(balances, rates, true);
}

/** «و3 أصناف أخرى» — the items the SMS had no room for. */
function remainingItemsAr(n: number): string {
  if (n === 1) return 'وصنف واحد آخر';
  if (n === 2) return 'وصنفان آخران';
  if (n <= 10) return `و${n} أصناف أخرى`;
  return `و${n} صنفاً أخرى`;
}

// The movement notice, compact: the same lines without the rules, the emoji or
// the ≈-in-riyals line on the balance. It is short to begin with, so only a long
// note pushes it over — and that is what the last level trims.
function compactNotice(o: MessageInput, notice: NoticeInfo, level: number): string {
  const head = `إشعار حركة رقم ${notice.number}`;
  const sender = o.senderName.trim();
  const note = (o.note ?? '').trim();

  const build = (noteText: string) => [
    level >= 1 ? head : `${head} - ${compactStamp(notice.issuedAt)}`,
    ...(level < 2 && sender ? [`${roleDef(o.role).senderLabelAr}: ${sender}`] : []),
    ...entryLines(o.role, o.type, o.amount, o.currency, o.rates),
    ...(noteText ? [`ملاحظة: ${noteText}`] : []),
    ...compactBalance(o.balances, o.rates, level < 3),
  ].join('\n');

  const whole = build(note);
  if (level < 4 || whole.length <= SMS_BUDGET) return whole;
  // Cut the note rather than let the phone decide where the message ends.
  const room = SMS_BUDGET - build('…').length;
  return build(`${note.slice(0, Math.max(0, room))}…`);
}

// A single entry is short by nature — sender, one line for the entry, the
// balance — so it keeps the layout the owner specified and is touched only if
// something has made it overrun, which in practice means a long note.
function trimmedSingle(o: MessageInput, level: number): string {
  if (level >= 2) {
    // Keep the head of the note and say that it was cut, rather than let the
    // phone quietly decide where the message ends. The room left is measured
    // against the message as it would be with a one-character note, so the
    // «ملاحظة من …: » prefix is counted rather than guessed at.
    const note = (o.note ?? '').trim();
    const whole = buildMessage({ ...o, note }, false);
    if (whole.length <= SMS_BUDGET) return whole;
    // Room = what a message carrying a one-character note leaves spare; the
    // note may run that many characters longer before the ellipsis.
    const room = SMS_BUDGET - buildMessage({ ...o, note: '…' }, false).length;
    return buildMessage({ ...o, note: `${note.slice(0, Math.max(0, room))}…` }, false);
  }
  return buildMessage(o, level < 1);
}

/**
 * The same notice, written to fit in an SMS.
 *
 * Sheds one thing at a time and stops as soon as the message fits, so a short
 * invoice is not stripped for a limit it was never near. If even the last level
 * overruns, that message is returned anyway — a too-long SMS still says what
 * happened, and silently dropping the notice would break the rule the whole
 * flow rests on: no notice, no debt.
 */
export function buildSmsMessage(opts: MessageInput): string {
  let message = '';
  for (let level = 0; level <= MAX_TRIM; level++) {
    if (opts.invoice) message = compactInvoice(opts, opts.invoice, level);
    else if (opts.notice) message = compactNotice(opts, opts.notice, level);
    else message = trimmedSingle(opts, level);
    if (message.length <= SMS_BUDGET) return message;
  }
  return message;
}

// ---- Handing the message to another app ----
//
// Each of these answers whether the app was actually opened, which the WebView
// on its own cannot do. `window.open('https://wa.me/…')` is a WEB address: on a
// phone with no WhatsApp, Android opens a browser on WhatsApp's download page,
// and on a bare emulator with neither, nothing happens and no error is raised.
// The owner taps send and watches nothing occur; a Play reviewer does the same
// and files it as broken. So on Android these go through explicit intents in
// `OutboundPlugin.java`, which reports back.
//
// `*Available` exists so the app can ask BEFORE it writes: a debt is recorded
// only once the notice is really going out (see useContactNotifier), and that
// promise can only be kept if the question is answerable in advance.

interface OutboundPlugin {
  canOpenWhatsApp(): Promise<{ available: boolean }>;
  openWhatsApp(options: { phone: string; text: string }): Promise<{ opened: boolean }>;
  canOpenSms(): Promise<{ available: boolean }>;
  openSms(options: { phone: string; text: string }): Promise<{ opened: boolean }>;
  openEmail(options: { to: string; subject: string; body: string }): Promise<{ opened: boolean }>;
  openUrl(options: { url: string }): Promise<{ opened: boolean }>;
}

const Outbound = registerPlugin<OutboundPlugin>('Outbound');

const isAndroid = () => Capacitor.getPlatform() === 'android';

/** wa.me deep link — still used on the web, where there is no intent to fire. */
export function whatsappUrl(phone: string, message: string): string {
  return `https://wa.me/${toIntlDigits(phone)}?text=${encodeURIComponent(message)}`;
}

export async function whatsappAvailable(): Promise<boolean> {
  if (!isAndroid()) return true; // the browser can always open wa.me
  try {
    return (await Outbound.canOpenWhatsApp()).available;
  } catch {
    return false;
  }
}

/** Open the WhatsApp chat with the message filled in. False = not installed. */
export async function openWhatsApp(phone: string, message: string): Promise<boolean> {
  if (!isAndroid()) {
    window.open(whatsappUrl(phone, message), '_blank');
    return true;
  }
  try {
    return (await Outbound.openWhatsApp({ phone: toIntlDigits(phone), text: message })).opened;
  } catch {
    return false;
  }
}

export async function smsAvailable(): Promise<boolean> {
  if (!isAndroid()) return false; // no SMS from a browser
  try {
    return (await Outbound.canOpenSms()).available;
  } catch {
    return false;
  }
}

/**
 * Open the phone's own messaging app with the number and the message already
 * filled in. The owner taps send.
 *
 * It used to send in the BACKGROUND, with no tap, through cordova-sms-plugin
 * and the SEND_SMS permission. That permission had to go: Google Play restricts
 * SEND_SMS to apps whose core purpose is messaging — the default SMS handler —
 * and refuses everything else, so the app could never be published while it
 * held it. There is no declaration form that changes this.
 *
 * The replacement needs NO permission at all. An ACTION_SENDTO intent starts
 * the user's own messaging app; the message is sent by the person, from the app
 * they already trust, which is also why Play is happy with it. The cost is one
 * extra tap per notice, and no way to confirm delivery.
 *
 * 🧩 Server concept: capability vs. delegation. Asking for SEND_SMS is asking
 * to hold the capability yourself — the app can then message anyone, silently,
 * forever. Firing an intent DELEGATES the act to a component the user controls,
 * keeping the same outcome without ever holding the power. Least privilege is
 * the same idea as `daftar_user` having DML but not DDL on the droplet: hold
 * what the job needs, and no more.
 */
export async function openSms(phone: string, message: string): Promise<boolean> {
  if (!isAndroid()) return false;
  try {
    return (await Outbound.openSms({ phone: toIntlDigits(phone), text: message })).opened;
  } catch {
    return false;
  }
}

/** Open the mail app on a pre-filled message. False = no mail app. */
export async function openEmail(
  to: string, subject: string, body: string,
): Promise<boolean> {
  if (!isAndroid()) {
    window.open(
      `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      '_blank',
    );
    return true;
  }
  try {
    return (await Outbound.openEmail({ to, subject, body })).opened;
  } catch {
    return false;
  }
}

/** Open a web address in the phone's browser. False = no browser. */
export async function openUrl(url: string): Promise<boolean> {
  if (!isAndroid()) {
    window.open(url, '_blank');
    return true;
  }
  try {
    return (await Outbound.openUrl({ url })).opened;
  } catch {
    return false;
  }
}
