import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db';
import { asyncHandler } from '../asyncHandler';
import { normalizePhone } from '../auth/phone';
import { createLoginThrottle } from '../auth/loginThrottle';
import { requirePosActor, PosRequest } from '../middleware/posActor';
import { parsePermissions } from '../pos/permissions';

// POST /auth/staff/login — a POS staff member (cashier / adder / admin) signs in
// with their own phone + password and gets a STAFF token. That token opens
// /pos-sync and nothing else (requireAuth refuses it; see middleware/auth.ts).
//
// Separate from the owner's /auth/login on purpose: the two are different kinds
// of account, and one endpoint guessing which one a number belongs to is how a
// cashier ends up holding an owner's token.

const router = Router();
/** Wrong passwords in a row before a staff login is locked (owner unlocks). */
export const MAX_STAFF_FAILURES = 4;
const throttle = createLoginThrottle();

// Compared against when the phone is unknown, so a wrong NUMBER takes as long
// as a wrong PASSWORD — the response time must not reveal which numbers exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

type Row = Record<string, unknown>;

export function signStaffToken(staffId: string, tokenVersion: number): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return jwt.sign({ sub: staffId, typ: 'staff', tv: tokenVersion }, secret, { expiresIn: '30d' });
}

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const password = req.body?.password;
    if (!phone || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'phone and password are required' });
    }
    if (throttle.blocked(phone)) {
      return res.status(429).json({ error: 'too many attempts, try again later' });
    }

    const [rows] = await pool.query(
      `SELECT s.id, s.name, s.role, s.permissions, s.password_hash, s.token_version, s.disabled_at,
              s.failed_logins, s.locked_at,
              u.subscription_status, u.pos_staff_enabled, u.pos_notes_enabled, u.store_name, u.pos_manager_pin
         FROM pos_staff s JOIN users u ON u.id = s.owner_id
        WHERE s.phone = ?`,
      [phone],
    );
    const staff = (rows as Row[])[0];
    // Locked after MAX_STAFF_FAILURES wrong passwords: refused, even with the
    // right one, until the owner sets a new password.
    if (staff && staff.locked_at !== null) return res.status(423).json({ error: 'account locked' });
    const ok = await bcrypt.compare(password, staff ? String(staff.password_hash) : DUMMY_HASH);
    if (!staff || !ok) {
      throttle.fail(phone);
      if (staff) {
        const failed = Number(staff.failed_logins) + 1;
        const lock = failed >= MAX_STAFF_FAILURES;
        await pool.query(
          'UPDATE pos_staff SET failed_logins = ?, locked_at = IF(?, NOW(3), locked_at) WHERE id = ?',
          [failed, lock ? 1 : 0, staff.id],
        );
        if (lock) return res.status(423).json({ error: 'account locked' });
      }
      return res.status(401).json({ error: 'invalid phone or password' });
    }
    throttle.succeed(phone);
    if (Number(staff.failed_logins) > 0) {
      await pool.query('UPDATE pos_staff SET failed_logins = 0 WHERE id = ?', [staff.id]);
    }

    // Checked only AFTER the password, so neither answer tells a stranger that
    // the number exists.
    if (staff.disabled_at !== null) return res.status(403).json({ error: 'staff account disabled' });
    if (staff.subscription_status === 'suspended') return res.status(403).json({ error: 'account suspended' });
    if (Number(staff.pos_staff_enabled) !== 1) return res.status(403).json({ error: 'staff accounts are not enabled' });

    // The owner's report: when this member signed in.
    await pool.query(
      `INSERT INTO pos_staff_sessions (owner_id, staff_id) SELECT owner_id, id FROM pos_staff WHERE id = ?`,
      [staff.id],
    );

    return res.json({
      token: signStaffToken(String(staff.id), Number(staff.token_version)),
      staff: {
        id: staff.id, name: staff.name, role: staff.role,
        permissions: [...parsePermissions(staff.permissions)],
      },
      store_name: staff.store_name ?? null,
      notes_enabled: Number(staff.pos_notes_enabled) === 1,
      manager_pin: staff.pos_manager_pin ?? null, // a salted hash — checked offline to undo a sale
    });
  }),
);

// GET /auth/staff/me — who this staff token belongs to, and what they may do
// NOW. The app calls it on open and after a sync, so a permission the owner
// switched off disappears from the screen too (the server already refuses it).
// Not behind requireSubscription: a member must still learn they are signed in
// when the shop's server sync is off.
router.get(
  '/me',
  requirePosActor,
  asyncHandler(async (req: PosRequest, res) => {
    if (!req.staff) return res.status(400).json({ error: 'not a staff token' });
    const [rows] = await pool.query(
      `SELECT s.name, u.store_name, u.pos_notes_enabled, u.pos_manager_pin FROM pos_staff s JOIN users u ON u.id = s.owner_id
        WHERE s.id = ? AND s.owner_id = ?`,
      [req.staff.id, req.userId],
    );
    const row = (rows as Row[])[0];
    if (!row) return res.status(401).json({ error: 'invalid or expired token' });
    return res.json({
      staff: { id: req.staff.id, name: row.name, role: req.staff.role, permissions: [...req.staff.permissions] },
      store_name: row.store_name ?? null,
      notes_enabled: Number(row.pos_notes_enabled) === 1,
      manager_pin: row.pos_manager_pin ?? null,
    });
  }),
);

// POST /auth/staff/logout — the member signs out from the app: close their
// latest open session (the owner's report shows when they left).
router.post(
  '/logout',
  requirePosActor,
  asyncHandler(async (req: PosRequest, res) => {
    if (!req.staff) return res.status(400).json({ error: 'not a staff token' });
    await pool.query(
      `UPDATE pos_staff_sessions SET logout_at = NOW(3)
        WHERE owner_id = ? AND staff_id = ? AND logout_at IS NULL
        ORDER BY login_at DESC LIMIT 1`,
      [req.userId, req.staff.id],
    );
    return res.json({ ok: true });
  }),
);

export default router;
