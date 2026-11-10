import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { pool } from '../db';
import { asyncHandler } from '../asyncHandler';
import { PosRequest } from '../middleware/posActor';
import { normalizePhone, isValidPhone } from '../auth/phone';
import {
  PERMISSIONS, ROLE_PRESETS, checkPermissionList, isStaffRole, parsePermissions,
  serializePermissions, type Permission,
} from '../pos/permissions';

// The shop's staff list. Mounted behind requirePosActor + requireNotSuspended +
// requirePos + requireStaffFeature + requireStaffManager: the OWNER, or a staff
// member holding `manage_staff`, of a shop the developer switched staff on for.
// Every query is filtered by owner_id = req.userId: an id from another shop is
// a 404, never a change.
//
//   GET    /pos-staff        → the list (never the password hash)
//   POST   /pos-staff        { name, phone, role, password, permissions? }
//   PATCH  /pos-staff/:id    { name?, role?, permissions?, password?, disabled? }
//
// A staff manager is held to three rules, so `manage_staff` cannot be turned
// into more power than it was given:
//   1. they can only grant permissions they hold themselves;
//   2. they cannot change anyone who holds a permission they lack;
//   3. they cannot change themselves.
// The owner is bound by none of them.
//
// No DELETE: a member is DISABLED — reversible, and it keeps who they were.
// A new password or disabling bumps token_version, which signs that person out
// at once. Permissions need no sign-out: they are read on every request.

const router = Router();
type Row = Record<string, unknown>;

const NAME_MAX = 100;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 128; // bcrypt reads only the first 72 bytes; a cap also bounds the hashing work
const BCRYPT_COST = 10;
const COLS = 'id, name, phone, role, permissions, disabled_at, created_at';

const toPublic = (r: Row) => ({
  id: r.id, name: r.name, phone: r.phone, role: r.role,
  permissions: [...parsePermissions(r.permissions)],
  disabled: r.disabled_at !== null && r.disabled_at !== undefined,
  created_at: r.created_at,
});

function checkPassword(v: unknown): string | null {
  return typeof v === 'string' && v.length >= PASSWORD_MIN && v.length <= PASSWORD_MAX ? v : null;
}
function checkName(v: unknown): string | null {
  const name = typeof v === 'string' ? v.trim() : '';
  return name && name.length <= NAME_MAX ? name : null;
}

/** What the caller may hand out: everything for the owner, their own set for a member. */
const grantable = (req: PosRequest): ReadonlySet<Permission> =>
  req.staff ? req.staff.permissions : new Set(PERMISSIONS);
const within = (set: Iterable<Permission>, limit: ReadonlySet<Permission>) =>
  [...set].every((p) => limit.has(p));

/** Is this number already someone's login — another staff member's, or an
 *  owner's? Refused either way: one number must mean one person at the login
 *  screen. */
async function phoneTaken(phone: string): Promise<boolean> {
  const [rows] = await pool.query(
    'SELECT 1 FROM pos_staff WHERE phone = ? UNION ALL SELECT 1 FROM users WHERE phone = ? LIMIT 1',
    [phone, phone],
  );
  return (rows as Row[]).length > 0;
}

router.get(
  '/',
  asyncHandler(async (req: PosRequest, res) => {
    const [rows] = await pool.query(
      `SELECT ${COLS} FROM pos_staff WHERE owner_id = ? ORDER BY created_at`,
      [req.userId],
    );
    return res.json({ staff: (rows as Row[]).map(toPublic), permissions: PERMISSIONS, presets: ROLE_PRESETS });
  }),
);

router.post(
  '/',
  asyncHandler(async (req: PosRequest, res) => {
    const name = checkName(req.body?.name);
    const phone = normalizePhone(req.body?.phone);
    const role = req.body?.role;
    const password = checkPassword(req.body?.password);
    if (!name) return res.status(400).json({ error: 'name is required (max 100 characters)' });
    if (!isValidPhone(phone)) return res.status(400).json({ error: 'phone must be 6–20 digits' });
    if (!isStaffRole(role)) return res.status(400).json({ error: 'role must be admin, cashier or adder' });
    if (!password) return res.status(400).json({ error: 'password must be 6–128 characters' });
    const permissions = req.body?.permissions === undefined
      ? [...ROLE_PRESETS[role]]
      : checkPermissionList(req.body.permissions);
    if (!permissions) return res.status(400).json({ error: 'unknown permission' });
    if (!within(permissions, grantable(req))) {
      return res.status(403).json({ error: 'cannot grant a permission you do not have' });
    }
    if (await phoneTaken(phone)) return res.status(409).json({ error: 'phone already in use' });

    const id = randomUUID();
    const now = new Date();
    const stored = serializePermissions(permissions);
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    try {
      await pool.query(
        `INSERT INTO pos_staff (id, owner_id, name, phone, role, permissions, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, req.userId, name, phone, role, stored, hash, now, now],
      );
    } catch (err) {
      // Two requests for the same number at once: the unique index decides.
      if ((err as { code?: string })?.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'phone already in use' });
      }
      throw err;
    }
    return res.status(201).json({
      staff: toPublic({ id, name, phone, role, permissions: stored, disabled_at: null, created_at: now }),
    });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req: PosRequest, res) => {
    const [found] = await pool.query(
      `SELECT ${COLS} FROM pos_staff WHERE id = ? AND owner_id = ?`,
      [req.params.id, req.userId],
    );
    const target = (found as Row[])[0];
    if (!target) return res.status(404).json({ error: 'staff member not found' });

    const limit = grantable(req);
    if (req.staff) {
      if (req.staff.id === target.id) return res.status(403).json({ error: 'cannot change your own account' });
      if (!within(parsePermissions(target.permissions), limit)) {
        return res.status(403).json({ error: 'cannot change a member with permissions you do not have' });
      }
    }

    const body = req.body ?? {};
    const sets: string[] = [];
    const args: unknown[] = [];
    let signOut = false;

    if (body.name !== undefined) {
      const name = checkName(body.name);
      if (!name) return res.status(400).json({ error: 'name is required (max 100 characters)' });
      sets.push('name = ?'); args.push(name);
    }
    let permissions: Permission[] | null = null;
    const role: unknown = body.role;
    if (role !== undefined) {
      if (!isStaffRole(role)) return res.status(400).json({ error: 'role must be admin, cashier or adder' });
      sets.push('role = ?'); args.push(role);
      permissions = [...ROLE_PRESETS[role]]; // a new role starts from its preset…
    }
    if (body.permissions !== undefined) {
      permissions = checkPermissionList(body.permissions); // …unless the list is given too
      if (!permissions) return res.status(400).json({ error: 'unknown permission' });
    }
    if (permissions) {
      if (!within(permissions, limit)) {
        return res.status(403).json({ error: 'cannot grant a permission you do not have' });
      }
      sets.push('permissions = ?'); args.push(serializePermissions(permissions));
    }
    if (body.password !== undefined) {
      const password = checkPassword(body.password);
      if (!password) return res.status(400).json({ error: 'password must be 6–128 characters' });
      sets.push('password_hash = ?'); args.push(await bcrypt.hash(password, BCRYPT_COST)); signOut = true;
    }
    if (body.disabled !== undefined) {
      if (typeof body.disabled !== 'boolean') return res.status(400).json({ error: 'disabled must be true or false' });
      sets.push(body.disabled ? 'disabled_at = COALESCE(disabled_at, ?)' : 'disabled_at = NULL');
      if (body.disabled) args.push(new Date());
      signOut = true;
    }
    if (sets.length === 0) return res.status(400).json({ error: 'nothing to change' });
    if (signOut) sets.push('token_version = token_version + 1');
    sets.push('updated_at = ?'); args.push(new Date());

    // `sets` holds only the fixed fragments above — no client text reaches the SQL.
    await pool.query(
      `UPDATE pos_staff SET ${sets.join(', ')} WHERE id = ? AND owner_id = ?`,
      [...args, req.params.id, req.userId],
    );
    const [rows] = await pool.query(
      `SELECT ${COLS} FROM pos_staff WHERE id = ? AND owner_id = ?`,
      [req.params.id, req.userId],
    );
    return res.json({ staff: toPublic((rows as Row[])[0]) });
  }),
);

// GET /pos-staff/:id/report?from=YYYY-MM-DD&to=YYYY-MM-DD — the OWNER's
// report on one member: when they signed in and out, and what they sold per
// day. Owner only: no staff member sees it, not even one managing staff.
// `day` is the phone's LOCAL calendar day, as every POS row carries it. The
// sign-ins are instants; they are returned with a day of margin on each side
// and the app sorts them into its own local days.
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
router.get(
  '/:id/report',
  asyncHandler(async (req: PosRequest, res) => {
    if (req.staff) return res.status(403).json({ error: 'owner only' });
    const from = String(req.query.from ?? '');
    const to = String(req.query.to ?? '');
    if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) {
      return res.status(400).json({ error: 'from and to must be YYYY-MM-DD, from <= to' });
    }
    const [member] = await pool.query(
      'SELECT id, name FROM pos_staff WHERE id = ? AND owner_id = ?', [req.params.id, req.userId],
    );
    if ((member as Row[]).length === 0) return res.status(404).json({ error: 'staff member not found' });

    const [sessions] = await pool.query(
      `SELECT login_at, logout_at FROM pos_staff_sessions
        WHERE owner_id = ? AND staff_id = ?
          AND login_at >= DATE_SUB(?, INTERVAL 1 DAY) AND login_at < DATE_ADD(?, INTERVAL 2 DAY)
        ORDER BY login_at`,
      [req.userId, req.params.id, from, to],
    );
    const [days] = await pool.query(
      `SELECT day, CAST(SUM(qty) AS SIGNED) AS qty, CAST(SUM(qty * price) AS SIGNED) AS amount
         FROM pos_sales
        WHERE user_id = ? AND staff_id = ? AND day BETWEEN ? AND ?
        GROUP BY day ORDER BY day`,
      [req.userId, req.params.id, from, to],
    );
    const list = (days as Row[]).map((d) => ({ day: String(d.day), qty: Number(d.qty), amount: Number(d.amount) }));
    return res.json({
      staff: (member as Row[])[0],
      sessions: sessions as Row[],
      days: list,
      totals: {
        qty: list.reduce((n, d) => n + d.qty, 0),
        amount: list.reduce((n, d) => n + d.amount, 0),
      },
    });
  }),
);

export default router;
