import { Capacitor } from '@capacitor/core';
import { formatMinor } from '../data/money';
import {
  BASE_CURRENCY, baseValueLine, currencyDef, formatAmount, hasRate, totalInBase,
  type CurrencyBalance, type CurrencyCode, type Rates,
} from '../data/currencies';
import { contactBalanceLabel, contactDirectionLabel } from '../data/roles';
import { tafqeetBaseMinor } from './tafqeet';
import type { TxnType } from '../data/transactions';

// Customer notifications: when the shopkeeper records a debt/payment we tell the
// customer. Two channels, both sent FROM the shopkeeper's own phone/number:
//   - SMS  : auto-sent (no tap) — Android only, via the cordova-sms-plugin.
//   - WhatsApp: opened on demand (a tap) via a wa.me deep link, pre-filled.
// Local Yemeni SIM-to-SIM SMS is cheap, so SMS is the default reach; WhatsApp is
// the richer option when the customer uses it.

const YEMEN_CC = '967';

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
}): string {
  const { senderName, role, type, amount, currency, balances, rates, note } = opts;
  const sender = senderName.trim();
  const lines: string[] = [];

  if (sender) lines.push(sender);

  // What just happened, in the currency it was recorded in — then its riyal
  // value, with the rate, when it wasn't riyals.
  lines.push(`${contactDirectionLabel(role, type)} ${formatAmount(amount, currency)}`);
  const entryInBase = baseValueLine(amount, currency, rates);
  if (entryInBase) lines.push(entryInBase);

  lines.push(''); // the balance is a separate thought
  lines.push(...balanceLines(balances, rates));

  if (note && note.trim()) {
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
      lines.push(`${formatAmount(Math.abs(b.minor), b.currency)} ${contactBalanceLabel(b.minor)}`);
      // With one currency the total line below already gives the riyal value.
      if (balances.length > 1) {
        const inBase = baseValueLine(Math.abs(b.minor), b.currency, rates, false);
        if (inBase) lines.push(inBase);
      }
    }
  }

  if (canTotal) {
    const { minor: totalMinor, complete } = totalInBase(balances, rates);
    const baseShort = currencyDef(BASE_CURRENCY).shortAr;
    // Say so rather than quietly understating the debt when a rate is missing.
    const partial = complete ? '' : ' (عدا ما لم يُحدَّد سعره)';
    lines.push(
      `رصيدك الآن: ${formatMinor(Math.abs(totalMinor))} ${baseShort} ` +
      `${contactBalanceLabel(totalMinor)}${partial}`
    );
    lines.push(tafqeetBaseMinor(Math.abs(totalMinor)));
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

// Auto-send an SMS from the shopkeeper's phone — no UI, no tap. Android only:
// uses cordova-sms-plugin (window.sms) with an empty intent so it sends directly
// (requires the SEND_SMS permission, requested at runtime by the plugin). On web
// / iOS this is a safe no-op so the dev loop and builds keep working.
export async function sendSms(phone: string, message: string): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'android') return false;
  const sms = (window as unknown as { sms?: SmsPlugin }).sms;
  if (!sms) {
    console.warn('SMS plugin not available — skipping auto-SMS');
    return false;
  }
  return new Promise<boolean>((resolve) => {
    sms.send(
      toIntlDigits(phone),
      message,
      { replaceLineBreaks: false, android: { intent: '' } }, // intent '' = send directly
      () => resolve(true),
      (err: unknown) => {
        console.warn('auto-SMS failed', err);
        resolve(false);
      }
    );
  });
}

// Minimal shape of the cordova-sms-plugin API we use.
interface SmsPlugin {
  send(
    phone: string,
    message: string,
    options: { replaceLineBreaks: boolean; android: { intent: string } },
    success: () => void,
    error: (err: unknown) => void
  ): void;
}
