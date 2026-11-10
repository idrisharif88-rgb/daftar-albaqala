// What each POS staff role may CHANGE, per table of /pos-sync/push. One table,
// so the rules are read in one place and changed in one place.
//
//   admin   — everything the owner can do at the point of sale.
//   cashier — sells. Nothing else: no products, no quantities, no day lock.
//   adder   — enters the day's quantities (baked / stock). Cannot create or
//             edit products (so cannot change a price), cannot sell.
//
// Reading (/pos-sync/pull) is allowed to every role: the app needs the
// products to sell them and the quantities to know what is in stock. What a
// role is SHOWN is the app's job; what it may WRITE is enforced here.
//
// Staff management (/pos-staff) is the owner's alone — no role may add staff.

export const STAFF_ROLES = ['admin', 'cashier', 'adder'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type PosTable = 'products' | 'baked' | 'sales' | 'day_locks';

const CAN_WRITE: Record<StaffRole, Record<PosTable, boolean>> = {
  admin:   { products: true,  baked: true,  sales: true,  day_locks: true },
  cashier: { products: false, baked: false, sales: true,  day_locks: false },
  adder:   { products: false, baked: true,  sales: false, day_locks: false },
};

/** May this actor push rows of this table? `undefined` role = the owner. */
export function canWrite(role: StaffRole | undefined, table: PosTable): boolean {
  return role === undefined ? true : CAN_WRITE[role][table];
}

export const isStaffRole = (v: unknown): v is StaffRole =>
  typeof v === 'string' && (STAFF_ROLES as readonly string[]).includes(v);
