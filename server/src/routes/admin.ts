import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db';
import { asyncHandler } from '../asyncHandler';
import { requireAdmin, adminJwtSecret } from '../middleware/requireAdmin';
import { verifyTotp } from '../admin/totp';

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
                 WHERE t.user_id = u.id) AS transactions_count,
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

export default router;
