// Phone is the login identity (Yemen is phone-first; many users have no email).
// Normalize to digits only — strips spaces, dashes and a leading +, so the same
// number typed different ways maps to one account. Shared by owner and staff
// logins, so both read a number the same way.
export function normalizePhone(raw: unknown): string {
  return String(raw ?? '').replace(/[\s-]/g, '').replace(/^\+/, '');
}

export const isValidPhone = (phone: string): boolean => /^\d{6,20}$/.test(phone);
