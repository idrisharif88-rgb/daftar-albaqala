import { Response, NextFunction } from 'express';
import { pool } from '../db';
import { AuthedRequest } from './auth';

// The point-of-sale section is switched on per account by the owner (Watcher →
// users.pos_enabled). The SERVER is the enforcement point, as with the
// subscription: a tampered app must not be able to store POS rows for an
// account that was never given the section. 403, not 402 — this is not about
// payment. Sits after requireAuth.
export async function requirePos(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const [rows] = await pool.query('SELECT pos_enabled FROM users WHERE id = ?', [req.userId]);
    const user = (rows as Array<Record<string, unknown>>)[0];
    if (!user) return res.status(401).json({ error: 'user not found' });
    if (Number(user.pos_enabled) !== 1) {
      return res.status(403).json({ error: 'point of sale is not enabled for this account' });
    }
    next();
  } catch (err) {
    next(err);
  }
}
