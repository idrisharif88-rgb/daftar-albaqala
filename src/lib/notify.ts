import { Capacitor } from '@capacitor/core';
import { formatMinor } from '../data/money';
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
// customer's new running balance and its direction. The grocer's note, if any,
// is appended on its own line as "ملاحظة من <store>: <note>".
export function buildMessage(opts: {
  storeName: string;
  type: TxnType;
  amount: number; // minor units
  balance: number; // minor units (signed; + = customer owes the shop)
  currency: string;
  note?: string;
}): string {
  const { storeName, type, amount, balance, currency, note } = opts;
  const store = storeName.trim();
  const action = type === 'debt' ? 'تسجيل دين' : 'تسجيل دفعة';
  const amountStr = `${formatMinor(amount)} ${currency}`;
  const balStr = `${formatMinor(Math.abs(balance))} ${currency}`;
  const balLine =
    balance > 0
      ? `رصيدك الآن: ${balStr} (عليك)`
      : balance < 0
        ? `رصيدك الآن: ${balStr} (لك)`
        : 'رصيدك الآن: مسدد';
  const head = store ? `${store}\n` : '';
  let msg = `${head}تم ${action} بمبلغ ${amountStr}\n${balLine}`;
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
