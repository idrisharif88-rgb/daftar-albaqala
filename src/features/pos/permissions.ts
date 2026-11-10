import { useAuth } from '../../lib/auth';

// POS staff permissions, as the APP sees them. The codes are the server's
// (server/src/pos/permissions.ts) — the server is the one that ENFORCES them;
// this file only decides what a staff member is SHOWN, so a button that would
// be refused is not offered in the first place.
//
// The owner holds every permission. A staff member holds what the server says
// (refreshed from GET /auth/staff/me on every launch).

export const PERMISSIONS = [
  'sell', 'add_stock', 'see_stock', 'see_reports', 'manage_products', 'submit_day', 'manage_staff',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  sell: 'البيع',
  add_stock: 'إدخال الكميات والمخزون',
  see_stock: 'رؤية المخزون',
  see_reports: 'رؤية التقارير والسجل',
  manage_products: 'إدارة المنتجات والأسعار',
  submit_day: 'اعتماد اليوم',
  manage_staff: 'إدارة الموظفين',
};

export const STAFF_ROLES = ['admin', 'cashier', 'adder'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: 'مدير',
  cashier: 'كاشير',
  adder: 'مُدخل الكميات',
};

/** What each role starts with. Same as the server's presets; the server fills
 *  them when none are sent, so a mismatch here only changes the form's ticks. */
export const ROLE_PRESETS: Record<StaffRole, readonly Permission[]> = {
  admin: PERMISSIONS,
  cashier: ['sell'],
  adder: ['add_stock', 'see_stock', 'see_reports'],
};

export const isPermission = (v: unknown): v is Permission =>
  typeof v === 'string' && (PERMISSIONS as readonly string[]).includes(v);

export const isStaffRole = (v: unknown): v is StaffRole =>
  typeof v === 'string' && (STAFF_ROLES as readonly string[]).includes(v);

/** `can('sell')` — true for the owner, and for a member holding it. */
export function usePosPermissions(): (p: Permission) => boolean {
  const { staff } = useAuth();
  if (!staff) return () => true;
  const held = new Set(staff.permissions);
  return (p) => held.has(p);
}
