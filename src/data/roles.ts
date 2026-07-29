import type { TxnType } from './transactions';

// What a contact is to the owner of the book.
//
// The app started life as "grocer → customers", where money only ever flowed
// one way. The owner also wants to track debts with the traders they buy from,
// and with the shop they themselves buy from — so a contact can now be someone
// the owner OWES, not just someone who owes them.
//
// The ledger itself did not need a new concept for that: it already has a
// signed balance. What the role changes is LANGUAGE. Recording «دين» against a
// supplier reads backwards, so each role names the two directions in its own
// terms while the arithmetic underneath stays identical for everyone.

export type ContactRole = 'customer' | 'supplier' | 'partner';

export interface RoleDef {
  role: ContactRole;
  /** Singular, for a chip on a row — «عميل». */
  labelAr: string;
  /** Plural, for the filter tabs — «عملاء». */
  pluralAr: string;
  /**
   * Button/label text for the two directions.
   *  - `plus`  raises the balance: the contact owes the owner more.
   *  - `minus` lowers it: the owner owes the contact more.
   * Stored as type 'debt' / 'payment' respectively — those are the append-only
   * values already in both databases, so they stay as they are.
   */
  plusAr: string;
  minusAr: string;
}

export const ROLES: RoleDef[] = [
  {
    role: 'customer', labelAr: 'عميل', pluralAr: 'عملاء',
    plusAr: 'دين', minusAr: 'دفعة',
  },
  {
    // A supplier is usually owed BY the owner, so the everyday entry is the
    // minus one: goods taken on credit.
    role: 'supplier', labelAr: 'مورد', pluralAr: 'موردين',
    plusAr: 'سداد له', minusAr: 'بضاعة بالأجل',
  },
  {
    // Peer trade — money moves both ways with equal likelihood.
    role: 'partner', labelAr: 'شريك', pluralAr: 'شركاء',
    plusAr: 'أعطيته', minusAr: 'أخذت منه',
  },
];

export const DEFAULT_ROLE: ContactRole = 'customer';

const BY_ROLE = new Map<string, RoleDef>(ROLES.map((r) => [r.role, r]));

export function isContactRole(value: unknown): value is ContactRole {
  return typeof value === 'string' && BY_ROLE.has(value);
}

/** Unknown roles degrade to customer — a contact synced from a newer app
 *  version must never make an older one unusable. */
export function roleDef(role: string): RoleDef {
  return BY_ROLE.get(role) ?? BY_ROLE.get(DEFAULT_ROLE)!;
}

/** The label for one direction of entry, in this role's terms. */
export function directionLabel(role: string, type: TxnType): string {
  const def = roleDef(role);
  return type === 'debt' ? def.plusAr : def.minusAr;
}

// ---- Balance wording ----
//
// Two audiences, two perspectives, and mixing them up is how a grocer sends a
// customer a message saying the wrong person owes the money:
//   - the OWNER's screens read from the owner's side  → «عليه» / «عليك»
//   - the CONTACT's SMS/WhatsApp reads from theirs    → «عليك» / «لك»

export type BalanceDirection = 'they_owe' | 'we_owe' | 'settled';

export function balanceDirection(minor: number): BalanceDirection {
  if (minor > 0) return 'they_owe';
  if (minor < 0) return 'we_owe';
  return 'settled';
}

/** Owner-facing: what this balance means for the person holding the phone. */
export function ownerBalanceLabel(minor: number): string {
  switch (balanceDirection(minor)) {
    case 'they_owe': return 'عليه';
    case 'we_owe': return 'عليك';
    default: return 'مسدد';
  }
}

/** Contact-facing, for notifications: what it means for the recipient. */
export function contactBalanceLabel(minor: number): string {
  switch (balanceDirection(minor)) {
    case 'they_owe': return 'عليك';
    case 'we_owe': return 'لك';
    default: return 'مسدد';
  }
}

/** Ionic colour for a balance — kept in one place so the list, the detail
 *  screen, the PDF and the spreadsheet can't drift apart. */
export function balanceColor(minor: number): 'danger' | 'primary' | 'medium' {
  switch (balanceDirection(minor)) {
    case 'they_owe': return 'danger';
    case 'we_owe': return 'primary';
    default: return 'medium';
  }
}
