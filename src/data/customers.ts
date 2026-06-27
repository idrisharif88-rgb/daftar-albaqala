import { getDB, persist } from './db';
import { uuidv4 } from './uuid';

// Customer repository — the only code that reads/writes the local `customers`
// table. Enforces the rules from CLAUDE.md: UUID PKs, app-layer phone
// uniqueness (within this device's non-deleted rows), soft-delete, and marking
// rows `synced = 0` on every change so the sync layer can find them later.

export interface Customer {
  id: string;
  name: string;
  phone: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const COLS = 'id, name, phone, note, created_at, updated_at, deleted_at';
const nowIso = () => new Date().toISOString();

// List active (non-deleted) customers, alphabetical.
export async function listCustomers(): Promise<Customer[]> {
  const db = await getDB();
  const res = await db.query(
    `SELECT ${COLS} FROM customers WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`
  );
  return (res.values ?? []) as Customer[];
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const db = await getDB();
  const res = await db.query(`SELECT ${COLS} FROM customers WHERE id = ?`, [id]);
  return ((res.values ?? [])[0] as Customer) ?? null;
}

// True if an active customer already uses this phone (excluding `exceptId`).
export async function phoneExists(phone: string, exceptId?: string): Promise<boolean> {
  const db = await getDB();
  const res = await db.query(
    `SELECT id FROM customers
      WHERE phone = ? AND deleted_at IS NULL AND id <> ?`,
    [phone, exceptId ?? '']
  );
  return (res.values ?? []).length > 0;
}

export async function createCustomer(input: {
  name: string;
  phone: string;
  note?: string | null;
}): Promise<Customer> {
  const name = input.name.trim();
  const phone = input.phone.trim();
  if (!name) throw new Error('الاسم مطلوب');
  if (!phone) throw new Error('رقم الهاتف مطلوب');
  if (await phoneExists(phone)) throw new Error('رقم الهاتف مستخدم لعميل آخر');

  const db = await getDB();
  const id = uuidv4();
  const now = nowIso();
  await db.run(
    `INSERT INTO customers (id, name, phone, note, created_at, updated_at, deleted_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 0)`,
    [id, name, phone, input.note ?? null, now, now]
  );
  await persist();
  return { id, name, phone, note: input.note ?? null, created_at: now, updated_at: now, deleted_at: null };
}

export async function updateCustomer(
  id: string,
  fields: { name?: string; phone?: string; note?: string | null }
): Promise<void> {
  const current = await getCustomer(id);
  if (!current) throw new Error('العميل غير موجود');

  const name = fields.name?.trim() ?? current.name;
  const phone = fields.phone?.trim() ?? current.phone;
  const note = fields.note !== undefined ? fields.note : current.note;
  if (!name) throw new Error('الاسم مطلوب');
  if (!phone) throw new Error('رقم الهاتف مطلوب');
  if (await phoneExists(phone, id)) throw new Error('رقم الهاتف مستخدم لعميل آخر');

  const db = await getDB();
  await db.run(
    `UPDATE customers SET name = ?, phone = ?, note = ?, updated_at = ?, synced = 0 WHERE id = ?`,
    [name, phone, note, nowIso(), id]
  );
  await persist();
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
