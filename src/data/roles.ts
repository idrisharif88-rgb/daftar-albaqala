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
// shop you buy from reads backwards, so each role names the two directions in
// its own terms while the arithmetic underneath stays identical for everyone.
//
// Two vocabularies per role, and keeping them apart is the whole point:
//   - OWNER-facing  (buttons, history rows, PDF, Excel) — read from the side of
//     the person holding the phone.
//   - CONTACT-facing (SMS / WhatsApp) — read from the side of the recipient, so
//     «أخذت منه» becomes «أخذت منك».

export type ContactRole = 'customer' | 'supplier' | 'partner';

export interface RoleDef {
  role: ContactRole;
  /** Singular, for a chip on a row — «زبون». */
  labelAr: string;
  /** Plural, for the filter tabs — «زبائن». */
  pluralAr: string;
  /**
   * Owner-facing text for the two directions.
   *  - `plus`  raises the balance: the contact owes the owner more.
   *  - `minus` lowers it: the owner owes the contact more.
   * Stored as type 'debt' / 'payment' respectively — those are the append-only
   * values already in both databases, so they stay as they are.
   */
  plusAr: string;
  minusAr: string;
  /** The same two directions as the CONTACT reads them in a message. */
  plusContactAr: string;
  minusContactAr: string;
  /**
   * Which of the two types makes what is owed GROW, for this role. It is not
   * always 'debt': for a shop the owner buys from, taking goods on credit is
   * stored as 'payment' (it lowers the signed balance). Colour and button
   * order follow this, so a new debt is never painted green.
   */
  growsType: TxnType;
}

export const ROLES: RoleDef[] = [
  {
    // Someone who buys from the owner — the original case.
    role: 'customer', labelAr: 'زبون', pluralAr: 'زبائن',
    plusAr: 'تسجيل دين', minusAr: 'تسديد دفعة',
    plusContactAr: 'تسجيل دين', minusContactAr: 'تسديد دفعة',
    growsType: 'debt',
  },
  {
    // A shop the owner buys FROM. Same two words as a customer — a debt is a
    // debt — but the sign is mirrored: goods taken on credit lower the balance,
    // so «تسجيل دين» is the minus direction here.
    role: 'supplier', labelAr: 'صاحب متجر', pluralAr: 'أصحاب المتاجر',
    plusAr: 'تسديد دفعة', minusAr: 'تسجيل دين',
    plusContactAr: 'تسديد دفعة', minusContactAr: 'تسجيل دين',
    growsType: 'payment',
  },
  {
    // Peer trade — money moves both ways, so the wording is plainly personal.
    role: 'partner', labelAr: 'شريك', pluralAr: 'شركاء',
    plusAr: 'دفعت له', minusAr: 'أخذت منه',
    plusContactAr: 'دفعت لك', minusContactAr: 'أخذت منك',
    growsType: 'payment',
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

/** Owner-facing label for one direction of entry, in this role's terms. */
export function directionLabel(role: string, type: TxnType): string {
  const def = roleDef(role);
  return type === 'debt' ? def.plusAr : def.minusAr;
}

/** Contact-facing label — what the recipient of the SMS/WhatsApp message reads. */
export function contactDirectionLabel(role: string, type: TxnType): string {
  const def = roleDef(role);
  return type === 'debt' ? def.plusContactAr : def.minusContactAr;
}

/** True when this entry increases what is owed (rather than settling it). The
 *  answer depends on the role, not on the raw type — see `growsType`. */
export function isGrowthEntry(role: string, type: TxnType): boolean {
  return roleDef(role).growsType === type;
}

/** Ionic colour for an entry: a growing debt is red, a settlement green. */
export function directionColor(role: string, type: TxnType): 'danger' | 'success' {
  return isGrowthEntry(role, type) ? 'danger' : 'success';
}

/** The two entry types in the order they should be offered: the everyday one
 *  (the debt-growing direction) first. */
export function orderedTypes(role: string): [TxnType, TxnType] {
  const grows = roleDef(role).growsType;
  return [grows, grows === 'debt' ? 'payment' : 'debt'];
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
