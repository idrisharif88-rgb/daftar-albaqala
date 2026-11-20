import { Capacitor, registerPlugin } from '@capacitor/core';

// The verification code message — the wording approved by the owner
// (2026-11-20). Two forms: WhatsApp has no length limit; the SMS must stay
// short (Arabic SMS = 70 characters per part, 67 once chained).

export const APP_NAME = 'فليكتب';

/** «482 915» — easier to read aloud and to copy by eye. */
export function spacedCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export function whatsappMessage(code: string): string {
  return [
    `*${APP_NAME} | Shopbook*`,
    'رمز التحقق الخاص بك هو:',
    '',
    `*${spacedCode(code)}*`,
    '',
    'أدخل هذا الرمز في التطبيق لتأكيد رقم هاتفك.',
    'صالح لمدة 10 دقائق.',
    '',
    `🔒 لا تشارك هذا الرمز مع أي شخص، حتى لو ادّعى أنه من فريق ${APP_NAME}. لن نطلبه منك أبداً.`,
    '',
    'إذا لم تطلب هذا الرمز، تجاهل الرسالة.',
  ].join('\n');
}

export function smsMessage(code: string): string {
  return `${APP_NAME}: رمز التحقق ${code}\nصالح 10 دقائق. لا تشاركه مع أحد، فريق ${APP_NAME} لن يطلبه منك أبداً.`;
}

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
