import { Response, NextFunction } from 'express';
import { pool } from '../db';
import { AuthedRequest, readBearer } from './auth';
import type { StaffRole } from '../pos/staffRoles';

// Who is at the point of sale: the OWNER (his ordinary token), or one of his
// STAFF (a staff token). Either way req.userId ends up as the OWNER's id, so
// every query below this — already filtered by req.userId — reads and writes
// the owner's POS data and nobody else's. What a staff member may change is
// decided per table in routes/posSync.ts from req.staff.role.
//
// A staff token is NOT trusted on its own word. On every request the staff row
// is read back and must still exist, be enabled, belong to an owner who is not
// suspended, and carry the same token_version the token was issued with. So a
// disabled cashier, or one whose password was changed, is out at once rather
// than when a 30-day token runs out.
//
// 🧩 Server concept: a JWT is a signed claim, valid until it expires; it cannot
// be "taken back". A version number checked against the database is the usual
// way to make it revocable: the token stays valid, but what it points at no
// longer matches.

export interface PosRequest extends AuthedRequest {
  staff?: { id: string; role: StaffRole };
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
      `SELECT s.owner_id, s.role, s.token_version, s.disabled_at, u.subscription_status
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
    req.userId = String(staff.owner_id);
    req.staff = { id: payload.sub, role: staff.role as StaffRole };
    next();
  } catch (err) {
    next(err);
  }
}
