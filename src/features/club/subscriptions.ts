import { getDB, persist } from '../../data/db';
import { uuidv4 } from '../../data/uuid';
import { addTransaction } from '../../data/transactions';
import { BASE_CURRENCY, isCurrencyCode, type CurrencyCode } from '../../data/currencies';
import type { Customer } from '../../data/customers';
import { formatMinor } from '../../data/money';

// «دفتر النادي» data (Phase 43, step 3).
//   subscriber   = a contact with role 'member'
//   subscription = a ledger DEBT entry for its price + a row here with the
//                  package and its dates (this table, synced)
//   payment      = an ordinary ledger payment
// So balances, notices, statements and backups work unchanged.

export interface ClubSubscription {
  id: string;
  customer_id: string;
  package_name: string;
  days: number;
  /** Minor units: the package's price when sold. */
  list_price: number;
  /** Minor units: what THIS subscriber pays (≤ list_price = a discount). */
  price: number;
  currency: CurrencyCode;
  /** Local calendar days, «YYYY-MM-DD». The subscription is valid through end_date. */
  start_date: string;
  end_date: string;
  transaction_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const COLS = `id, customer_id, package_name, days, list_price, price, currency, start_date, end_date,
  transaction_id, note, created_at, updated_at, deleted_at`;

const nowIso = () => new Date().toISOString();
const pad = (n: number) => String(n).padStart(2, '0');

/** Today as a LOCAL calendar day. */
export function today(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `day` + n days, calendar arithmetic in local time. */
export function addDays(day: string, n: number): string {
  const [y, m, dd] = day.split('-').map(Number);
  return today(new Date(y, m - 1, dd + n));
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export type SubStatus = 'active' | 'soon' | 'expired' | 'none';
/** Days left before it counts as «قارب». */
export const SOON_DAYS = 3;

export function statusOf(sub: ClubSubscription | null, on = today()): { status: SubStatus; left: number } {
  if (!sub) return { status: 'none', left: 0 };
  const left = daysBetween(on, sub.end_date);
  if (left < 0) return { status: 'expired', left };
  if (left <= SOON_DAYS) return { status: 'soon', left };
  return { status: 'active', left };
}

function fromRow(r: Record<string, unknown>): ClubSubscription {
  return {
    id: String(r.id), customer_id: String(r.customer_id), package_name: String(r.package_name),
    days: Number(r.days), list_price: Number(r.list_price), price: Number(r.price),
    currency: isCurrencyCode(r.currency) ? r.currency : BASE_CURRENCY,
    start_date: String(r.start_date), end_date: String(r.end_date),
    transaction_id: (r.transaction_id as string | null) ?? null, note: (r.note as string | null) ?? null,
    created_at: String(r.created_at), updated_at: String(r.updated_at),
    deleted_at: (r.deleted_at as string | null) ?? null,
  };
}

// ---- Subscribers ----

const MEMBER_COLS = 'id, name, phone, note, role, created_at, updated_at, deleted_at, debt_limit, reminder_days, reminder_consent';

export async function listMembers(): Promise<Customer[]> {
  const db = await getDB();
  const res = await db.query(
    `SELECT ${MEMBER_COLS} FROM customers WHERE role = 'member' AND deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
  );
  return ((res.values ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id), name: String(r.name), phone: String(r.phone), note: (r.note as string | null) ?? null,
    role: 'member', created_at: String(r.created_at), updated_at: String(r.updated_at), deleted_at: null,
    debt_limit: r.debt_limit === null || r.debt_limit === undefined ? null : Number(r.debt_limit),
    reminder_days: r.reminder_days === null || r.reminder_days === undefined ? null : Number(r.reminder_days),
    reminder_consent: Number(r.reminder_consent) === 1,
  }));
}

/** A new subscriber. The phone is unique among the club's subscribers. */
export async function createMember(input: { name: string; phone: string; note?: string | null }): Promise<string> {
  const name = input.name.trim();
  const phone = input.phone.replace(/[^\d+]/g, '');
  if (!name) throw new Error('الاسم مطلوب');
  if (!phone) throw new Error('رقم الهاتف مطلوب');
  const db = await getDB();
  const dup = await db.query(
    `SELECT 1 FROM customers WHERE role = 'member' AND deleted_at IS NULL AND phone = ? LIMIT 1`, [phone],
  );
  if ((dup.values ?? []).length > 0) throw new Error('يوجد مشترك بهذا الرقم');
  const id = uuidv4();
  const now = nowIso();
  await db.run(
    `INSERT INTO customers (id, name, phone, note, role, created_at, updated_at, deleted_at, synced)
     VALUES (?, ?, ?, ?, 'member', ?, ?, NULL, 0)`,
    [id, name, phone, input.note?.trim() || null, now, now],
  );
  await persist();
  return id;
}

// ---- Subscriptions ----

export async function listSubscriptions(customerId: string): Promise<ClubSubscription[]> {
  const db = await getDB();
  const res = await db.query(
    `SELECT ${COLS} FROM club_subscriptions WHERE customer_id = ? AND deleted_at IS NULL
      ORDER BY end_date DESC, created_at DESC`,
    [customerId],
  );
  return ((res.values ?? []) as Record<string, unknown>[]).map(fromRow);
}

/** Each subscriber's LATEST subscription (by end date), one query for the list. */
export async function latestByMember(): Promise<Map<string, ClubSubscription>> {
  const db = await getDB();
  const res = await db.query(
    `SELECT ${COLS} FROM club_subscriptions WHERE deleted_at IS NULL ORDER BY end_date ASC, created_at ASC`,
  );
  const map = new Map<string, ClubSubscription>();
  for (const r of (res.values ?? []) as Record<string, unknown>[]) {
    const s = fromRow(r);
    map.set(s.customer_id, s); // later rows overwrite: the last is the latest
  }
  return map;
}

/** The words for a subscription — on the ledger entry AND in the message to
 *  the subscriber, so the two always say the same thing. */
export function subscriptionNote(input: {
  packageName: string; startDate: string; days: number; listPrice: number; price: number; note?: string | null;
}): string {
  const end = addDays(input.startDate, input.days - 1);
  const parts = [`اشتراك ${input.packageName.trim()}: من ${input.startDate} حتى ${end}`];
  if (input.listPrice > input.price) parts.push(`خصم ${formatMinor(input.listPrice - input.price)}`);
  if (input.note?.trim()) parts.push(input.note.trim());
  return parts.join(' — ');
}

/**
 * Sell a subscription: a DEBT entry for `price` (what this subscriber pays —
 * it may be below the package's price) and the dated row that explains it.
 * The subscription runs `days` days from `startDate` (inclusive), so a 30-day
 * package from the 15th ends on the 14th of next month… shown as «حتى».
 */
export async function createSubscription(input: {
  customerId: string;
  packageName: string;
  days: number;
  listPrice: number;
  price: number;
  startDate: string;
  note?: string | null;
}): Promise<ClubSubscription> {
  if (!input.packageName.trim()) throw new Error('اختر باقة');
  if (!Number.isInteger(input.days) || input.days < 1) throw new Error('عدد الأيام غير صحيح');
  if (!Number.isInteger(input.price) || input.price < 0) throw new Error('أدخل سعراً صحيحاً');
  const endDate = addDays(input.startDate, input.days - 1);

  // A free subscription (price 0) is a valid gift; it has no ledger entry.
  const txn = input.price > 0
    ? await addTransaction({ customerId: input.customerId, type: 'debt', amount: input.price, note: subscriptionNote(input) })
    : null;

  const db = await getDB();
  const id = uuidv4();
  const now = nowIso();
  await db.run(
    `INSERT INTO club_subscriptions
       (id, customer_id, package_name, days, list_price, price, currency, start_date, end_date,
        transaction_id, note, created_at, updated_at, deleted_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)`,
    [id, input.customerId, input.packageName.trim(), input.days, input.listPrice, input.price, BASE_CURRENCY,
     input.startDate, endDate, txn?.id ?? null, input.note?.trim() || null, now, now],
  );
  await persist();
  return {
    id, customer_id: input.customerId, package_name: input.packageName.trim(), days: input.days,
    list_price: input.listPrice, price: input.price, currency: BASE_CURRENCY,
    start_date: input.startDate, end_date: endDate, transaction_id: txn?.id ?? null,
    note: input.note?.trim() || null, created_at: now, updated_at: now, deleted_at: null,
  };
}

/** The day a renewal should start: the day after the current one ends, or
 *  today if it has already lapsed. */
export function nextStart(latest: ClubSubscription | null, on = today()): string {
  if (!latest) return on;
  const after = addDays(latest.end_date, 1);
  return after > on ? after : on;
}

// ---- Sync helpers (src/data/sync.ts) ----

/** On the wire: prices in MAJOR units, like every other money field. */
export interface WireClubSub {
  id: string; customer_id: string; package_name: string; days: number;
  list_price: number; price: number; currency: string;
  start_date: string; end_date: string; transaction_id: string | null; note: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
}

export async function getDirtySubscriptions(): Promise<WireClubSub[]> {
  const db = await getDB();
  const res = await db.query(`SELECT ${COLS} FROM club_subscriptions WHERE synced = 0`);
  return ((res.values ?? []) as Record<string, unknown>[]).map((r) => {
    const s = fromRow(r);
    return { ...s, list_price: s.list_price / 100, price: s.price / 100 };
  });
}

export async function markSubscriptionsSynced(rows: { id: string; updated_at: string }[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDB();
  for (const r of rows) {
    await db.run('UPDATE club_subscriptions SET synced = 1 WHERE id = ? AND updated_at = ?', [r.id, r.updated_at]);
  }
}

/** Apply a pulled row: insert if new, else last-write-wins. Lands synced. */
export async function applyServerSubscription(row: ClubSubscription): Promise<void> {
  const db = await getDB();
  const cur = await db.query('SELECT updated_at FROM club_subscriptions WHERE id = ?', [row.id]);
  const existing = (cur.values ?? [])[0] as { updated_at: string } | undefined;
  const vals = [row.customer_id, row.package_name, row.days, row.list_price, row.price, row.currency,
    row.start_date, row.end_date, row.transaction_id, row.note, row.updated_at, row.deleted_at];
  if (!existing) {
    await db.run(
      `INSERT INTO club_subscriptions
         (customer_id, package_name, days, list_price, price, currency, start_date, end_date,
          transaction_id, note, updated_at, deleted_at, id, created_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [...vals, row.id, row.created_at],
    );
  } else if (new Date(row.updated_at).getTime() > new Date(existing.updated_at).getTime()) {
    await db.run(
      `UPDATE club_subscriptions SET customer_id = ?, package_name = ?, days = ?, list_price = ?, price = ?,
              currency = ?, start_date = ?, end_date = ?, transaction_id = ?, note = ?, updated_at = ?,
              deleted_at = ?, synced = 1
        WHERE id = ?`,
      [...vals, row.id],
    );
  }
}
