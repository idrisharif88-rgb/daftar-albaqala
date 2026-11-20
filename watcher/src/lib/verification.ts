import { Capacitor, registerPlugin } from '@capacitor/core';

// The verification code message — the wording approved by the owner
// (2026-11-20). The SAME full text goes by WhatsApp and by SMS (owner's
// choice: the short SMS read as too terse). By SMS it is ~4 parts; only
// WhatsApp gets the *bold* marks, which an SMS would show as stars.

export const APP_NAME = 'فليكتب';

/** «482 915» — easier to read aloud and to copy by eye. */
export function spacedCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

function fullMessage(code: string, bold: (t: string) => string): string {
  return [
    bold(`${APP_NAME} | Shopbook`),
    'رمز التحقق الخاص بك هو:',
    '',
    bold(spacedCode(code)),
    '',
    'أدخل هذا الرمز في التطبيق لتأكيد رقم هاتفك.',
    'صالح لمدة 10 دقائق.',
    '',
    `🔒 لا تشارك هذا الرمز مع أي شخص، حتى لو ادّعى أنه من فريق ${APP_NAME}. لن نطلبه منك أبداً.`,
    '',
    'إذا لم تطلب هذا الرمز، تجاهل الرسالة.',
  ].join('\n');
}

export const whatsappMessage = (code: string): string => fullMessage(code, (t) => `*${t}*`);
export const smsMessage = (code: string): string => fullMessage(code, (t) => t);

/** Local number → international digits (Yemen 967), as WhatsApp expects. */
export function intlDigits(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('967')) return d;
  if (d.startsWith('0')) d = d.slice(1);
  return `967${d}`;
}

interface OutboundPlugin {
  openWhatsApp(o: { phone: string; text: string }): Promise<{ opened: boolean }>;
  openSms(o: { phone: string; text: string }): Promise<{ opened: boolean }>;
}
const Outbound = registerPlugin<OutboundPlugin>('Outbound');
const isAndroid = () => Capacitor.getPlatform() === 'android';

/** Open WhatsApp on this number with the code message. False = not opened. */
export async function sendByWhatsApp(phone: string, code: string): Promise<boolean> {
  const text = whatsappMessage(code);
  if (!isAndroid()) {
    window.open(`https://wa.me/${intlDigits(phone)}?text=${encodeURIComponent(text)}`, '_blank');
    return true;
  }
  try { return (await Outbound.openWhatsApp({ phone: intlDigits(phone), text })).opened; } catch { return false; }
}

/** Open the messaging app on this number with the short message. */
export async function sendBySms(phone: string, code: string): Promise<boolean> {
  const text = smsMessage(code);
  if (!isAndroid()) {
    window.open(`sms:${intlDigits(phone)}?body=${encodeURIComponent(text)}`, '_blank');
    return true;
  }
  try { return (await Outbound.openSms({ phone: intlDigits(phone), text })).opened; } catch { return false; }
}
