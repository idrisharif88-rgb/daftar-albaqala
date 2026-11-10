import { getDB, persist } from './db';
import { uuidv4 } from './uuid';
import { kickReminders } from './reminders';
import { DEFAULT_ROLE, VISIBLE_ROLE_CODES, isContactRole, type ContactRole } from './roles';

// Contact repository — the only code that reads/writes the local `customers`
// table. Enforces the rules from CLAUDE.md: UUID PKs, app-layer phone
// uniqueness (within this device's non-deleted rows), soft-delete, and marking
// rows `synced = 0` on every change so the sync layer can find them later.
//
// The table is still named `customers` (renaming it would mean a migration on
// every phone plus the server, for no behavioural gain) but a row is now any
// contact: a customer, a supplier, or a trading partner — see roles.ts.

export interface Customer {
  id: string;
  name: string;
  phone: string;
  note: string | null;
  role: ContactRole;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** Highest debt allowed, riyal MINOR units; null = no limit. */
  debt_limit: number | null;
  /** Automatic SMS reminder every N days (REMINDER_INTERVALS); null = none. */
  reminder_days: number | null;
  /** The owner recorded that this contact agreed to automatic reminders. */
  reminder_consent: boolean;
}

/** The reminder intervals the owner may pick, in days. Same list on the server. */
export const REMINDER_INTERVALS = [3, 7, 14, 30] as const;

const COLS = 'id, name, phone, note, role, created_at, updated_at, deleted_at, debt_limit, reminder_days, reminder_consent';
const nowIso = () => new Date().toISOString();

// Rows arrive untyped from SQLite; an unrecognised role degrades to the default
// instead of leaking a bad value into the UI.
function toCustomer(row: Record<string, unknown>): Customer {
  return {
    id: String(row.id),
    name: String(row.name),
    phone: String(row.phone),
    note: (row.note as string | null) ?? null,
    role: isContactRole(row.role) ? row.role : DEFAULT_ROLE,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    deleted_at: (row.deleted_at as string | null) ?? null,
    debt_limit: row.debt_limit === null || row.debt_limit === undefined ? null : Number(row.debt_limit),
    reminder_days: validDays(row.reminder_days),
    reminder_consent: Number(row.reminder_consent) === 1,
  };
}

function validDays(v: unknown): number | null {
  const n = Number(v);
  return v !== null && v !== undefined && (REMINDER_INTERVALS as readonly number[]).includes(n) ? n : null;
}

// List active (non-deleted) contacts of THIS build, alphabetical. A contact
// whose role belongs to the other app (one account used in both) is kept and
// synced, just not shown here.
export async function listCustomers(): Promise<Customer[]> {
  const db = await getDB();
  const marks = VISIBLE_ROLE_CODES.map(() => '?').join(', ');
  const res = await db.query(
    `SELECT ${COLS} FROM customers
      WHERE deleted_at IS NULL AND role IN (${marks})
      ORDER BY name COLLATE NOCASE`,
    VISIBLE_ROLE_CODES,
  );
  return ((res.values ?? []) as Record<string, unknown>[]).map(toCustomer);
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const db = await getDB();
  const res = await db.query(`SELECT ${COLS} FROM customers WHERE id = ?`, [id]);
  const row = (res.values ?? [])[0] as Record<string, unknown> | undefined;
  return row ? toCustomer(row) : null;
}

// True if an active contact IN THIS BUILD's book already uses this phone
// (excluding `exceptId`). The other app's book doesn't count: the same person
// can be a grocer's customer and a contractor's worker, and a number hidden
// from this screen must not block it with a duplicate nobody can see.
export async function phoneExists(phone: string, exceptId?: string): Promise<boolean> {
  const db = await getDB();
  const marks = VISIBLE_ROLE_CODES.map(() => '?').join(', ');
  const res = await db.query(
    `SELECT id FROM customers
      WHERE phone = ? AND deleted_at IS NULL AND id <> ? AND role IN (${marks})`,
    [phone, exceptId ?? '', ...VISIBLE_ROLE_CODES]
  );
  return (res.values ?? []).length > 0;
}

export async function createCustomer(input: {
  name: string;
  phone: string;
  note?: string | null;
  role?: ContactRole;
}): Promise<Customer> {
  const name = input.name.trim();
  const phone = input.phone.trim();
  if (!name) throw new Error('الاسم مطلوب');
  if (!phone) throw new Error('رقم الهاتف مطلوب');
  if (await phoneExists(phone)) throw new Error('رقم الهاتف مستخدم لجهة أخرى');
  const role = isContactRole(input.role) ? input.role : DEFAULT_ROLE;

  const db = await getDB();
  const id = uuidv4();
  const now = nowIso();
  await db.run(
    `INSERT INTO customers (id, name, phone, note, role, created_at, updated_at, deleted_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0)`,
    [id, name, phone, input.note ?? null, role, now, now]
  );
  await persist();
  return {
    id, name, phone, note: input.note ?? null, role,
    created_at: now, updated_at: now, deleted_at: null,
    debt_limit: null, reminder_days: null, reminder_consent: false,
  };
}

export async function updateCustomer(
  id: string,
  fields: { name?: string; phone?: string; note?: string | null; role?: ContactRole }
): Promise<void> {
  const current = await getCustomer(id);
  if (!current) throw new Error('الجهة غير موجودة');

  const name = fields.name?.trim() ?? current.name;
  const phone = fields.phone?.trim() ?? current.phone;
  const note = fields.note !== undefined ? fields.note : current.note;
  const role = isContactRole(fields.role) ? fields.role : current.role;
  if (!name) throw new Error('الاسم مطلوب');
  if (!phone) throw new Error('رقم الهاتف مطلوب');
  if (await phoneExists(phone, id)) throw new Error('رقم الهاتف مستخدم لجهة أخرى');

  const db = await getDB();
  await db.run(
    `UPDATE customers SET name = ?, phone = ?, note = ?, role = ?, updated_at = ?, synced = 0
      WHERE id = ?`,
    [name, phone, note, role, nowIso(), id]
  );
  await persist();
}

/**
 * The debt limit and the automatic reminder — kept apart from updateCustomer:
 * those fields are open to the shopkeeper, while name/phone/role are not.
 */
export async function setCustomerLimits(
  id: string,
  fields: { debtLimit: number | null; reminderDays: number | null; reminderConsent: boolean },
): Promise<void> {
  const limit = fields.debtLimit !== null && fields.debtLimit > 0 ? Math.round(fields.debtLimit) : null;
  const days = validDays(fields.reminderDays);
  const db = await getDB();
  await db.run(
    `UPDATE customers SET debt_limit = ?, reminder_days = ?, reminder_consent = ?, updated_at = ?, synced = 0
      WHERE id = ?`,
    [limit, days, fields.reminderConsent ? 1 : 0, nowIso(), id],
  );
  await persist();
  kickReminders();
}

// Soft-delete: write a tombstone (deleted_at) so the deletion syncs to the
// server. Transactions are left untouched (append-only / history is permanent).
export async function softDeleteCustomer(id: string): Promise<void> {
  const db = await getDB();
  await db.run(
    `UPDATE customers SET deleted_at = ?, updated_at = ?, synced = 0 WHERE id = ?`,
    [nowIso(), nowIso(), id]
  );
  await persist();
}

// ---- Sync helpers (used by data/sync.ts; they don't persist() — the sync run
// flushes once at the end) ----

// Rows changed locally but not yet pushed (synced = 0), incl. tombstones.
export async function getDirtyCustomers(): Promise<Customer[]> {
  const db = await getDB();
  const res = await db.query(`SELECT ${COLS} FROM customers WHERE synced = 0`);
  return ((res.values ?? []) as Record<string, unknown>[]).map(toCustomer);
}

// Mark pushed rows clean. Guarded by updated_at so a row edited again *during*
// the push isn't wrongly marked synced (it stays dirty for the next run).
export async function markCustomersSynced(rows: { id: string; updated_at: string }[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDB();
  for (const r of rows) {
    await db.run(`UPDATE customers SET synced = 1 WHERE id = ? AND updated_at = ?`, [r.id, r.updated_at]);
  }
}

// Apply a customer pulled from the server: insert if new, else last-write-wins
// by updated_at (a strictly-newer server row overwrites; otherwise keep local).
// Applied rows match the server, so they land synced = 1.
export async function applyServerCustomer(row: {
  id: string; name: string; phone: string; note: string | null; role: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
  /** Absent from a server older than limits — then the local values stay. */
  debt_limit?: number | null; reminder_days?: number | null; reminder_consent?: boolean;
}): Promise<void> {
  const db = await getDB();
  const existing = await getCustomer(row.id);
  const role = isContactRole(row.role) ? row.role : DEFAULT_ROLE;
  const limit = row.debt_limit !== undefined ? row.debt_limit : (existing?.debt_limit ?? null);
  const days = row.reminder_days !== undefined ? validDays(row.reminder_days) : (existing?.reminder_days ?? null);
  const consent = row.reminder_consent !== undefined ? row.reminder_consent : (existing?.reminder_consent ?? false);
  if (!existing) {
    await db.run(
      `INSERT INTO customers (id, name, phone, note, role, created_at, updated_at, deleted_at,
                              debt_limit, reminder_days, reminder_consent, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [row.id, row.name, row.phone, row.note ?? null, role,
       row.created_at, row.updated_at, row.deleted_at ?? null, limit, days, consent ? 1 : 0]
    );
  } else if (new Date(row.updated_at).getTime() > new Date(existing.updated_at).getTime()) {
    await db.run(
      `UPDATE customers SET name = ?, phone = ?, note = ?, role = ?, updated_at = ?, deleted_at = ?,
                            debt_limit = ?, reminder_days = ?, reminder_consent = ?, synced = 1
        WHERE id = ?`,
      [row.name, row.phone, row.note ?? null, role, row.updated_at, row.deleted_at ?? null,
       limit, days, consent ? 1 : 0, row.id]
    );
  }
}
