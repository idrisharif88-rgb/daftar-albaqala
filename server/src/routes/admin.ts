import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db';
import { asyncHandler } from '../asyncHandler';
import { requireAdmin, adminJwtSecret } from '../middleware/requireAdmin';
import { randomUUID } from 'crypto';
import { verifyTotp } from '../admin/totp';
import { VALID_ROLES } from '../domain';

// The Watcher app's API: the owner's view over EVERY account.
//
// ⚠️ These are the only routes in the server that are not filtered by a
// tenant's user_id — by design, the owner supports all accounts. That is why
// the door is three locks deep: phone + admin password + authenticator code,
// all configured in server/.env (never in the database, so an SQL injection
// anywhere else cannot mint an admin), and why everything past /login sits
// behind requireAdmin.

const router = Router();

const ADMIN_TOKEN_TTL = '12h';

// ---- Login throttling ----
//
// Every failed admin login counts against ONE global budget. Behind nginx all
// requests arrive from 127.0.0.1, so a per-IP limit would be a global one
// anyway — this just says so. The cost: someone hammering the endpoint can
// lock the owner out for LOCK_MS too. That is the right trade for a door with
// one legitimate user.
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

let failures: number[] = [];
let lockedUntil = 0;
let lastTotpStep = -1;

/** Tests only: forget failures, the lock and the last used code. */
export function resetAdminLoginState(): void {
  failures = [];
  lockedUntil = 0;
  lastTotpStep = -1;
}

function recordFailure(now: number): void {
  failures = failures.filter((t) => now - t < WINDOW_MS);
  failures.push(now);
  if (failures.length >= MAX_FAILURES) {
    lockedUntil = now + LOCK_MS;
    failures = [];
  }
}

function normalizePhone(raw: unknown): string {
  return String(raw ?? '').replace(/[\s-]/g, '').replace(/^\+/, '');
}

// POST /admin/login  { phone, password, code } → { token }
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const adminPhone = normalizePhone(process.env.ADMIN_PHONE);
    const passwordHash = process.env.ADMIN_PASSWORD_HASH;
    const totpSecret = process.env.ADMIN_TOTP_SECRET;
    const jwtSecret = adminJwtSecret();
    if (!adminPhone || !passwordHash || !totpSecret || !jwtSecret) {
      return res.status(503).json({ error: 'admin is not configured on this server' });
    }

    const now = Date.now();
    if (now < lockedUntil) {
      return res.status(429).json({ error: 'too many attempts, try later' });
    }

    const { phone, password, code } = req.body ?? {};
    // bcrypt runs whatever the phone was, so a wrong phone and a wrong
    // password take the same time and give the same answer.
    const passwordOk = await bcrypt.compare(String(password ?? ''), passwordHash);
    const phoneOk = normalizePhone(phone) === adminPhone;
    const step = verifyTotp(totpSecret, String(code ?? '').trim(), now);
    // A code already used is refused: one code, one login.
    const codeOk = step !== null && step > lastTotpStep;

    if (!passwordOk || !phoneOk || !codeOk) {
      recordFailure(now);
      return res.status(401).json({ error: 'invalid credentials' });
    }

    lastTotpStep = step as number;
    failures = [];
    const token = jwt.sign({ sub: 'admin', role: 'admin' }, jwtSecret, {
      expiresIn: ADMIN_TOKEN_TTL,
    });
    return res.json({ token });
  })
);

router.use(requireAdmin);

// GET /admin/users — every account, newest first, with a size and a last
// activity so the owner can see who actually uses the app.
router.get(
  '/users',
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query(
      `SELECT u.id, u.phone, u.store_name, u.plan,
              u.subscription_status, u.subscription_expires_at, u.created_at,
              (SELECT COUNT(*) FROM customers c
                 WHERE c.user_id = u.id AND c.deleted_at IS NULL) AS customers_count,
              (SELECT COUNT(*) FROM transactions t
                 WHERE t.user_id = u.id AND t.deleted_at IS NULL) AS transactions_count,
              GREATEST(
                COALESCE((SELECT MAX(c.server_updated_at) FROM customers c WHERE c.user_id = u.id), u.created_at),
                COALESCE((SELECT MAX(t.server_updated_at) FROM transactions t WHERE t.user_id = u.id), u.created_at)
              ) AS last_activity_at
         FROM users u
        ORDER BY u.created_at DESC`
    );
    const users = (rows as Array<Record<string, unknown>>).map((r) => ({
      ...r,
      customers_count: Number(r.customers_count),
      transactions_count: Number(r.transactions_count),
    }));
    return res.json({ users });
  })
);

// What the owner may set an account to. 'none' and 'expired' are states an
// account falls into, not ones the owner hands out.
const SETTABLE = new Set(['active', 'suspended']);

// POST /admin/users/:id/status  { status: 'active' | 'suspended' }
router.post(
  '/users/:id/status',
  asyncHandler(async (req, res) => {
    const status = String(req.body?.status ?? '');
    if (!SETTABLE.has(status)) {
      return res.status(400).json({ error: "status must be 'active' or 'suspended'" });
    }
    // Activating clears any expiry date: "active" from the owner means active,
    // not active-until-a-date-set-long-ago.
    const [result] = await pool.query(
      `UPDATE users
          SET subscription_status = ?,
              subscription_expires_at = CASE WHEN ? = 'active' THEN NULL ELSE subscription_expires_at END,
              updated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [status, status, req.params.id]
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      return res.status(404).json({ error: 'user not found' });
    }
    return res.json({ id: req.params.id, subscription_status: status });
  })
);

// ---- One account's book (slice 2) ----
//
// Every query below names the account in its WHERE clause — the contact AND the
// entry are both matched against :id. The admin may read any account, but a
// contact id pasted under the wrong account must still answer 404, never act on
// someone else's row.

type Row = Record<string, unknown>;

/** Per-currency balance (debt − payment) of live entries, keyed by contact. */
async function balancesFor(userId: string, customerId?: string): Promise<Map<string, Row[]>> {
  const [rows] = await pool.query(
    `SELECT customer_id, currency,
            SUM(CASE WHEN type = 'debt' THEN amount ELSE -amount END) AS balance,
            COUNT(*) AS n
       FROM transactions
      WHERE user_id = ? AND deleted_at IS NULL ${customerId ? 'AND customer_id = ?' : ''}
      GROUP BY customer_id, currency`,
    customerId ? [userId, customerId] : [userId]
  );
  const out = new Map<string, Row[]>();
  for (const r of rows as Row[]) {
    const key = String(r.customer_id);
    const list = out.get(key) ?? [];
    list.push({ currency: r.currency, balance: Number(r.balance), count: Number(r.n) });
    out.set(key, list);
  }
  return out;
}

async function findAccount(id: string): Promise<Row | null> {
  const [rows] = await pool.query(
    'SELECT id, phone, store_name, subscription_status FROM users WHERE id = ?',
    [id]
  );
  return (rows as Row[])[0] ?? null;
}

async function findContact(userId: string, customerId: string): Promise<Row | null> {
  const [rows] = await pool.query(
    `SELECT id, name, phone, note, role, created_at, updated_at
       FROM customers
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [customerId, userId]
  );
  return (rows as Row[])[0] ?? null;
}

// GET /admin/users/:id/customers — the account's live contacts, each with its
// balance per currency and its number of entries.
router.get(
  '/users/:id/customers',
  asyncHandler(async (req, res) => {
    const account = await findAccount(req.params.id);
    if (!account) return res.status(404).json({ error: 'user not found' });
    const [rows] = await pool.query(
      `SELECT id, name, phone, note, role, created_at, updated_at
         FROM customers
        WHERE user_id = ? AND deleted_at IS NULL
        ORDER BY name`,
      [req.params.id]
    );
    const balances = await balancesFor(req.params.id);
    const customers = (rows as Row[]).map((c) => {
      const b = balances.get(String(c.id)) ?? [];
      return {
        ...c,
        balances: b.filter((x) => x.balance !== 0).map(({ currency, balance }) => ({ currency, balance })),
        transactions_count: b.reduce((n, x) => n + Number(x.count), 0),
      };
    });
    return res.json({ account, customers });
  })
);

// GET /admin/users/:id/customers/:cid — one contact and its live entries,
// newest first, each with its id (the owner deletes by id).
router.get(
  '/users/:id/customers/:cid',
  asyncHandler(async (req, res) => {
    const contact = await findContact(req.params.id, req.params.cid);
    if (!contact) return res.status(404).json({ error: 'customer not found' });
    const [rows] = await pool.query(
      `SELECT id, type, amount, currency, note, occurred_at, created_at
         FROM transactions
        WHERE user_id = ? AND customer_id = ? AND deleted_at IS NULL
        ORDER BY occurred_at DESC, created_at DESC`,
      [req.params.id, req.params.cid]
    );
    const balances = (await balancesFor(req.params.id, req.params.cid)).get(req.params.cid) ?? [];
    return res.json({
      customer: {
        ...contact,
        balances: balances.filter((x) => x.balance !== 0).map(({ currency, balance }) => ({ currency, balance })),
      },
      transactions: (rows as Row[]).map((t) => ({ ...t, amount: Number(t.amount) })),
    });
  })
);

// PUT /admin/users/:id/customers/:cid  { name?, phone?, note?, role? }
//
// updated_at is stamped with the SERVER's clock: the phones merge contacts
// last-write-wins on updated_at, and an edit that kept the old value would be
// thrown away as stale on the next pull. server_updated_at bumps itself.
router.put(
  '/users/:id/customers/:cid',
  asyncHandler(async (req, res) => {
    const existing = await findContact(req.params.id, req.params.cid);
    if (!existing) return res.status(404).json({ error: 'customer not found' });
    const body = req.body ?? {};

    const name = body.name !== undefined ? String(body.name).trim() : String(existing.name);
    const phone = body.phone !== undefined ? String(body.phone).replace(/[\s-]/g, '') : String(existing.phone);
    const note = body.note !== undefined ? (String(body.note).trim() || null) : existing.note;
    const role = body.role !== undefined ? String(body.role) : String(existing.role);
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!phone) return res.status(400).json({ error: 'phone is required' });
    if (!VALID_ROLES.has(role)) return res.status(400).json({ error: 'invalid role' });

    // Same rule the app keeps: one live contact per phone in a book.
    if (phone !== existing.phone) {
      const [dupes] = await pool.query(
        `SELECT id FROM customers
          WHERE user_id = ? AND phone = ? AND deleted_at IS NULL AND id <> ?`,
        [req.params.id, phone, req.params.cid]
      );
      if ((dupes as Row[]).length > 0) {
        return res.status(409).json({ error: 'a customer with this phone already exists' });
      }
    }

    await pool.query(
      `UPDATE customers
          SET name = ?, phone = ?, note = ?, role = ?, updated_at = UTC_TIMESTAMP()
        WHERE id = ? AND user_id = ?`,
      [name, phone, note, role, req.params.cid, req.params.id]
    );
    return res.json({ customer: await findContact(req.params.id, req.params.cid) });
  })
);

// DELETE /admin/users/:id/customers/:cid — soft-delete (a tombstone every
// version of the app already understands). Its entries stay in the table.
router.delete(
  '/users/:id/customers/:cid',
  asyncHandler(async (req, res) => {
    const [result] = await pool.query(
      `UPDATE customers
          SET deleted_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [req.params.cid, req.params.id]
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      return res.status(404).json({ error: 'customer not found' });
    }
    return res.json({ id: req.params.cid, deleted: true });
  })
);

// DELETE /admin/users/:id/transactions/:tid — delete an entry outright.
//
// A tombstone, not a DELETE (see migration 006): the phones hold their own
// copy, and only a row that still exists can tell them to drop it. Reaches
// only an app new enough to ask for tombstones — for an older one, use the
// reversing entry below instead.
router.delete(
  '/users/:id/transactions/:tid',
  asyncHandler(async (req, res) => {
    const [result] = await pool.query(
      `UPDATE transactions
          SET deleted_at = UTC_TIMESTAMP()
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [req.params.tid, req.params.id]
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      return res.status(404).json({ error: 'transaction not found' });
    }
    return res.json({ id: req.params.tid, deleted: true });
  })
);

// POST /admin/users/:id/transactions/:tid/reverse — cancel an entry the
// append-only way: a NEW entry of the opposite type, same amount and currency.
// Every version of the app receives it, and both stay in the history.
router.post(
  '/users/:id/transactions/:tid/reverse',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT t.id, t.customer_id, t.type, t.amount, t.currency
         FROM transactions t
         JOIN customers c ON c.id = t.customer_id AND c.user_id = t.user_id
        WHERE t.id = ? AND t.user_id = ? AND t.deleted_at IS NULL AND c.deleted_at IS NULL`,
      [req.params.tid, req.params.id]
    );
    const original = (rows as Row[])[0];
    if (!original) return res.status(404).json({ error: 'transaction not found' });

    const id = randomUUID();
    const type = original.type === 'debt' ? 'payment' : 'debt';
    // The short id lets the owner, and the shopkeeper reading the history,
    // match the reversal to the entry it cancels.
    const note = `إلغاء حركة سابقة (${String(original.id).slice(0, 8)})`;
    await pool.query(
      `INSERT INTO transactions
         (id, user_id, customer_id, type, amount, currency, note, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [id, req.params.id, original.customer_id, type, original.amount, original.currency, note]
    );
    return res.status(201).json({ id, type, amount: Number(original.amount), currency: original.currency, note });
  })
);

export default router;
