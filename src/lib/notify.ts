import { Capacitor } from '@capacitor/core';
import { formatMinor } from '../data/money';
import {
  BASE_CURRENCY, currencyDef, describeAmount, totalInBase,
  type CurrencyBalance, type CurrencyCode, type Rates,
} from '../data/currencies';
import { contactBalanceLabel } from '../data/roles';
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

// The Arabic message: store name + what happened (debt/payment + amount) + the
// contact's new running balance and its direction. The grocer's note, if any,
// is appended on its own line as "ملاحظة من <store>: <note>".
//
// A debt in SAR, USD or gold is spelled out BOTH ways — «100 ر.س (≈ 14,000
// ريال سعر الصرف 140)» — because the two sides of the deal think in different
// units. The customer needs to see the figure they'll be judged by AND the
// rate it was worked out at, or the conversion looks arbitrary when the rate
// moves next week. The native amount stays the debt of record.
export function buildMessage(opts: {
  storeName: string;
  type: TxnType;
  amount: number; // minor units
  currency: CurrencyCode; // what the entry was recorded in
  balances: CurrencyBalance[]; // running balance per currency (+ = they owe us)
  rates: Rates;
  note?: string;
}): string {
  const { storeName, type, amount, currency, balances, rates, note } = opts;
  const store = storeName.trim();
  const action = type === 'debt' ? 'تسجيل دين' : 'تسجيل دفعة';
  const amountStr = describeAmount(amount, currency, rates);

  let balanceBlock: string;
  if (balances.length === 0) {
    balanceBlock = 'رصيدك الآن: مسدد';
  } else if (balances.length === 1) {
    const b = balances[0];
    balanceBlock =
      `رصيدك الآن: ${describeAmount(Math.abs(b.minor), b.currency, rates)} (${contactBalanceLabel(b.minor)})`;
  } else {
    // Several currencies never merge into one figure, so they're listed — with
    // a combined riyal estimate underneath, clearly labelled as today's rates.
    const lines = balances.map(
      (b) => `  • ${describeAmount(Math.abs(b.minor), b.currency, rates)} (${contactBalanceLabel(b.minor)})`
    );
    const { minor: totalMinor, complete } = totalInBase(balances, rates);
    if (complete) {
      const baseShort = currencyDef(BASE_CURRENCY).shortAr;
      lines.push(
        `  الإجمالي التقريبي: ${formatMinor(Math.abs(totalMinor))} ${baseShort} ` +
        `(${contactBalanceLabel(totalMinor)}) بأسعار اليوم`
      );
    }
    balanceBlock = `رصيدك الآن:\n${lines.join('\n')}`;
  }

  const head = store ? `${store}\n` : '';
  let msg = `${head}تم ${action} بمبلغ ${amountStr}\n${balanceBlock}`;
  if (note && note.trim()) {
    msg += `\nملاحظة من ${store || 'البقالة'}: ${note.trim()}`;
  }
  return msg;
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
