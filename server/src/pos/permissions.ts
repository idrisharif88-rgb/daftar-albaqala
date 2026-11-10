// POS staff permissions — the ONE list of what a staff member may be allowed.
//
// A member holds a set of these codes (pos_staff.permissions, JSON). The role
// (admin / cashier / adder) is only a PRESET that fills the set when the member
// is added; the owner — or a member holding `manage_staff` — can switch any
// permission on or off afterwards.
//
// To add a permission later: add its code here, decide which presets get it,
// and (if it guards a write) map it in WRITE_PERMISSION. The app reads the same
// codes from the server, so nothing else has to agree by hand.
//
// What the SERVER enforces:
//   sell, add_stock, manage_products, submit_day — the rows a member may push
//   to /pos-sync (WRITE_PERMISSION below); manage_staff — /pos-staff; notes —
//   both writing AND receiving notes (routes/posSync.ts), and only in a shop
//   whose notes the developer switched on.
// What only the APP enforces (by what it shows):
//   see_stock, see_reports — /pos-sync/pull returns the whole POS data to every
//   member, because selling needs the products and «in stock» needs the
//   quantities. These two decide what a member is SHOWN, not what reaches the
//   phone. Treat them as tidiness, not as secrecy.

export const PERMISSIONS = [
  'sell',            // record sales
  'add_stock',       // enter the day's quantities / add stock
  'see_stock',       // see stock and quantities
  'see_reports',     // see the day's report and the history
  'manage_products', // add / edit products and their prices
  'submit_day',      // submit (lock) and reopen the day
  'manage_staff',    // add / edit / disable other staff
  'notes',           // read and write the shop's notes (only where the developer switched notes on)
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const STAFF_ROLES = ['admin', 'cashier', 'adder'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_PRESETS: Record<StaffRole, readonly Permission[]> = {
  admin: PERMISSIONS,
  cashier: ['sell', 'notes'],
  adder: ['add_stock', 'see_stock', 'see_reports', 'notes'],
};

export type PosTable = 'products' | 'baked' | 'sales' | 'day_locks' | 'notes';

const WRITE_PERMISSION: Record<PosTable, Permission> = {
  products: 'manage_products',
  baked: 'add_stock',
  sales: 'sell',
  day_locks: 'submit_day',
  notes: 'notes',
};

/** The owner (no staff record) may do everything. */
export type Actor = { permissions: ReadonlySet<Permission> } | undefined;

export function can(actor: Actor, permission: Permission): boolean {
  return actor === undefined || actor.permissions.has(permission);
}

export function canWrite(actor: Actor, table: PosTable): boolean {
  return can(actor, WRITE_PERMISSION[table]);
}

export const isPermission = (v: unknown): v is Permission =>
  typeof v === 'string' && (PERMISSIONS as readonly string[]).includes(v);

export const isStaffRole = (v: unknown): v is StaffRole =>
  typeof v === 'string' && (STAFF_ROLES as readonly string[]).includes(v);

/** Read the stored JSON. Anything unknown or malformed is DROPPED, never
 *  guessed at: a damaged row grants less, not more. */
export function parsePermissions(raw: unknown): Set<Permission> {
  try {
    const list: unknown = JSON.parse(String(raw ?? '[]'));
    return new Set(Array.isArray(list) ? list.filter(isPermission) : []);
  } catch {
    return new Set();
  }
}

/** Validate a list sent by a client: every entry must be a known code.
 *  Returns null when anything is wrong (the request is refused, not trimmed). */
export function checkPermissionList(v: unknown): Permission[] | null {
  if (!Array.isArray(v) || !v.every(isPermission)) return null;
  return PERMISSIONS.filter((p) => v.includes(p)); // de-duplicated, in a stable order
}

/** Store a set in a stable order, so equal sets are equal strings. */
export const serializePermissions = (set: Iterable<Permission>): string => {
  const s = new Set(set);
  return JSON.stringify(PERMISSIONS.filter((p) => s.has(p)));
};
