import type { Balance, Role } from './api';

// Short names, as on the shopkeeper app's screens.
const CURRENCY_AR: Record<string, string> = {
  YER: 'ريال', SAR: 'ر.س', USD: '$', GOLD: 'جرام ذهب',
};

export const ROLE_AR: Record<Role, string> = {
  customer: 'زبون',
  supplier: 'صاحب متجر',
  partner: 'شريك',
};

export function money(amount: number, currency: string): string {
  const n = Math.abs(amount).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `${n} ${CURRENCY_AR[currency] ?? currency}`;
}

/** «700 ريال عليه» — positive means the contact owes the book's owner. */
export function balanceText(b: Balance): string {
  return `${money(b.balance, b.currency)} ${b.balance > 0 ? 'عليه' : 'له'}`;
}

// Fixed 2026-10-02 14:05, Latin digits — same as the shopkeeper app's exports.
export function dateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
