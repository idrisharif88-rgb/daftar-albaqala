import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { pool } from '../db';
import { asyncHandler } from '../asyncHandler';
import { AuthedRequest } from '../middleware/auth';
import { normalizePhone, isValidPhone } from '../auth/phone';
import { isStaffRole } from '../pos/staffRoles';

// The owner's staff list — OWNER ONLY. Mounted behind requireAuth (which
// refuses staff tokens), requireNotSuspended and requirePos. Every query is
// filtered by owner_id = req.userId: an id from another shop is a 404, never a
// change.
//
//   GET    /pos-staff        → the list (never the password hash)
//   POST   /pos-staff        { name, phone, role, password }
//   PATCH  /pos-staff/:id    { name?, role?, password?, disabled? }
//
// No DELETE: a staff member is DISABLED, which keeps who they were (a future
// audit trail names them) and is reversible. Changing the role, the password or
// the disabled flag bumps token_version, which signs that person out at once
// (see middleware/posActor.ts).

const router = Router();
type Row = Record<string, unknown>;

const NAME_MAX = 100;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 128; // bcrypt reads only the first 72 bytes; a cap also bounds the hashing work
const BCRYPT_COST = 10;

const toPublic = (r: Row) => ({
  id: r.id, name: r.name, phone: r.phone, role: r.role,
  disabled: r.disabled_at !== null, created_at: r.created_at,
});

function checkPassword(v: unknown): string | null {
  return typeof v === 'string' && v.length >= PASSWORD_MIN && v.length <= PASSWORD_MAX ? v : null;
}
function checkName(v: unknown): string | null {
  const name = typeof v === 'string' ? v.trim() : '';
  return name && name.length <= NAME_MAX ? name : null;
}

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
  asyncHandler(async (req: AuthedRequest, res) => {
    const [rows] = await pool.query(
      `SELECT id, name, phone, role, disabled_at, created_at FROM pos_staff
        WHERE owner_id = ? ORDER BY created_at`,
      [req.userId],
    );
    return res.json({ staff: (rows as Row[]).map(toPublic) });
  }),
);

router.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const name = checkName(req.body?.name);
    const phone = normalizePhone(req.body?.phone);
    const role = req.body?.role;
    const password = checkPassword(req.body?.password);
    if (!name) return res.status(400).json({ error: 'name is required (max 100 characters)' });
    if (!isValidPhone(phone)) return res.status(400).json({ error: 'phone must be 6–20 digits' });
    if (!isStaffRole(role)) return res.status(400).json({ error: 'role must be admin, cashier or adder' });
    if (!password) return res.status(400).json({ error: 'password must be 6–128 characters' });
    if (await phoneTaken(phone)) return res.status(409).json({ error: 'phone already in use' });

    const id = randomUUID();
    const now = new Date();
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    try {
      await pool.query(
        `INSERT INTO pos_staff (id, owner_id, name, phone, role, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, req.userId, name, phone, role, hash, now, now],
      );
    } catch (err) {
      // Two requests for the same number at once: the unique index decides.
      if ((err as { code?: string })?.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'phone already in use' });
      }
      throw err;
    }
    return res.status(201).json({
      staff: toPublic({ id, name, phone, role, disabled_at: null, created_at: now }),
    });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body ?? {};
    const sets: string[] = [];
    const args: unknown[] = [];
    let signOut = false;

    if (body.name !== undefined) {
      const name = checkName(body.name);
      if (!name) return res.status(400).json({ error: 'name is required (max 100 characters)' });
      sets.push('name = ?'); args.push(name);
    }
    if (body.role !== undefined) {
      if (!isStaffRole(body.role)) return res.status(400).json({ error: 'role must be admin, cashier or adder' });
      sets.push('role = ?'); args.push(body.role); signOut = true;
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

    const [result] = await pool.query(
      `UPDATE pos_staff SET ${sets.join(', ')} WHERE id = ? AND owner_id = ?`,
      [...args, req.params.id, req.userId],
    );
    if ((result as { affectedRows?: number }).affectedRows !== 1) {
      return res.status(404).json({ error: 'staff member not found' });
    }
    const [rows] = await pool.query(
      'SELECT id, name, phone, role, disabled_at, created_at FROM pos_staff WHERE id = ? AND owner_id = ?',
      [req.params.id, req.userId],
    );
    return res.json({ staff: toPublic((rows as Row[])[0]) });
  }),
);

export default router;
