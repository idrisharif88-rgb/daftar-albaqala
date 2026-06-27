import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../db';

// Shared test utilities. These talk to the SAME pool as the app, so the tests
// run against whatever database server/.env-test points at — a dedicated
// `daftar_test` DB, never production `daftar_db`.

// A MySQL DATETIME string (UTC) for a given JS Date, e.g. '2026-06-25 10:30:00'.
// The app stores/compares DATETIME at second precision, so tests use the same.
export function mysqlDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// Wipe every table in FK-safe order (transactions → customers → users) so each
// test starts from a known-empty state.
export async function cleanDb(): Promise<void> {
  await pool.query('DELETE FROM transactions');
  await pool.query('DELETE FROM customers');
  await pool.query('DELETE FROM users');
}

// Each seeded tenant gets a unique phone (the login identity). A counter keeps
// them distinct within a run; cleanDb wipes between tests.
let phoneSeq = 0;

// Insert a tenant (shopkeeper) and return its id. password_hash is a dummy —
// these tests exercise sync, not login. By default the tenant has an ACTIVE
// subscription so /sync passes requireSubscription; pass a `sub` override to
// test the gate (e.g. { status: 'none' } or an expired date).
export async function seedUser(
  sub: { status?: 'none' | 'active' | 'expired'; expiresAt?: Date | null } = {}
): Promise<string> {
  const id = randomUUID();
  const phone = `7${String(phoneSeq++).padStart(8, '0')}`;
  const now = mysqlDate(new Date());
  const status = sub.status ?? 'active';
  const expiresAt =
    sub.expiresAt === undefined ? null : sub.expiresAt ? mysqlDate(sub.expiresAt) : null;
  await pool.query(
    `INSERT INTO users
       (id, phone, password_hash, subscription_status, subscription_expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, phone, 'x', status, expiresAt, now, now]
  );
  return id;
}

// A Bearer token the app's requireAuth middleware will accept for this user.
export function tokenFor(userId: string): string {
  const secret = process.env.JWT_SECRET as string;
  return jwt.sign({ sub: userId }, secret, { expiresIn: '1h' });
}

// Read one customer row straight from the DB (to assert what actually landed).
export async function getCustomer(id: string): Promise<Record<string, unknown> | undefined> {
  const [rows] = await pool.query('SELECT * FROM customers WHERE id = ?', [id]);
  return (rows as Record<string, unknown>[])[0];
}

// Count transactions for a customer (to assert append-only / no duplicates).
export async function countTransactions(customerId: string): Promise<number> {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS n FROM transactions WHERE customer_id = ?',
    [customerId]
  );
  return Number((rows as { n: number }[])[0].n);
}
