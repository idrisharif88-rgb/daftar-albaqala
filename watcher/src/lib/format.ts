import type { Balance, Role } from './api';

// Short names, as on the shopkeeper app's screens.
const CURRENCY_AR: Record<string, string> = {
  YER: 'ريال', SAR: 'ر.س', USD: '$', GOLD: 'جرام ذهب',
};

export const ROLE_AR: Record<Role, string> = {
  customer: 'زبون',
  supplier: 'صاحب متجر',
  partner: 'شريك',
  worker: 'عامل',
  client: 'جهة',
  broker: 'وسيط',
  materials: 'محل مواد',
};

const CONTRACTOR_ROLES: Role[] = ['worker', 'client', 'broker', 'materials'];
const GROCERY_ROLES: Role[] = ['customer', 'supplier', 'partner'];

/** The book a contact lives in. Each app shows only its own roles. */
export const isContractorRole = (r: string): boolean => (CONTRACTOR_ROLES as string[]).includes(r);

/** The chip on a contact: its role, plus «المقاول» for the contractor's book
 *  so the two books are told apart in one list. */
export const roleBadge = (r: string): string =>
  isContractorRole(r) ? `${ROLE_AR[r as Role]} · المقاول` : ROLE_AR[r as Role] ?? r;

/** The roles a contact may be changed to — only within its own book. Moving it
 *  to the other app's role would make it vanish from one app and appear in the
 *  other, history and all. */
export const rolesInSameBook = (r: string): Role[] =>
  isContractorRole(r) ? CONTRACTOR_ROLES : GROCERY_ROLES;

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
