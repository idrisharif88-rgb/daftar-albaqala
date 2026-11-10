import { Response, NextFunction } from 'express';
import { pool } from '../db';
import { AuthedRequest, readBearer } from './auth';
import { can, parsePermissions, type Permission, type StaffRole } from '../pos/permissions';

// Who is at the point of sale: the OWNER (his ordinary token), or one of his
// STAFF (a staff token). Either way req.userId ends up as the OWNER's id, so
// every query below this — already filtered by req.userId — reads and writes
// the owner's POS data and nobody else's. What a staff member may do is
// req.staff.permissions (pos/permissions.ts).
//
// A staff token is NOT trusted on its own word. On every request the staff row
// is read back and must still exist, be enabled, carry the same token_version
// the token was issued with, and belong to an owner who is not suspended and
// whose staff accounts the developer has switched on. Permissions are read
// from that row too, so a permission switched off applies to the very next
// request — no new login needed.
//
// 🧩 Server concept: a JWT is a signed claim, valid until it expires; it cannot
// be "taken back". A version number checked against the database is the usual
// way to make it revocable: the token stays valid, but what it points at no
// longer matches.

export interface StaffActor {
  id: string;
  role: StaffRole;
  permissions: ReadonlySet<Permission>;
}

export interface PosRequest extends AuthedRequest {
  staff?: StaffActor;
}

type Row = Record<string, unknown>;

export async function requirePosActor(req: PosRequest, res: Response, next: NextFunction) {
  const read = readBearer(req);
  if (!read.ok) return res.status(read.status).json({ error: read.error });
  const { payload } = read;

  if (payload.typ === undefined) {
    req.userId = payload.sub; // the owner himself
    return next();
  }
  if (payload.typ !== 'staff') return res.status(401).json({ error: 'invalid or expired token' });

  try {
    const [rows] = await pool.query(
      `SELECT s.owner_id, s.role, s.permissions, s.token_version, s.disabled_at,
              u.subscription_status, u.pos_staff_enabled
         FROM pos_staff s JOIN users u ON u.id = s.owner_id
        WHERE s.id = ?`,
      [payload.sub],
    );
    const staff = (rows as Row[])[0];
    if (!staff || staff.disabled_at !== null || Number(staff.token_version) !== payload.tv) {
      return res.status(401).json({ error: 'invalid or expired token' });
    }
    if (staff.subscription_status === 'suspended') {
      return res.status(403).json({ error: 'account suspended' });
    }
    if (Number(staff.pos_staff_enabled) !== 1) {
      return res.status(403).json({ error: 'staff accounts are not enabled' });
    }
    req.userId = String(staff.owner_id);
    req.staff = {
      id: payload.sub,
      role: staff.role as StaffRole,
      permissions: parsePermissions(staff.permissions),
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** The developer's switch for this shop (users.pos_staff_enabled). Off = the
 *  staff feature does not exist for it — 403, for the owner too. Sits after
 *  requirePosActor or requireAuth. */
export async function requireStaffFeature(req: PosRequest, res: Response, next: NextFunction) {
  try {
    const [rows] = await pool.query('SELECT pos_staff_enabled FROM users WHERE id = ?', [req.userId]);
    const user = (rows as Row[])[0];
    if (!user) return res.status(401).json({ error: 'user not found' });
    if (Number(user.pos_staff_enabled) !== 1) {
      return res.status(403).json({ error: 'staff accounts are not enabled' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Only the owner, or a member holding `manage_staff`. */
export function requireStaffManager(req: PosRequest, res: Response, next: NextFunction) {
  if (!can(req.staff, 'manage_staff')) {
    return res.status(403).json({ error: 'not allowed to manage staff' });
  }
  next();
}
