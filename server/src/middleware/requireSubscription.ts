import { Response, NextFunction } from 'express';
import { pool } from '../db';
import { AuthedRequest } from './auth';

type Row = Record<string, unknown>;

// MONETIZATION ENFORCEMENT (see CLAUDE.md): cloud sync is the paid feature, and
// the SERVER is the enforcement point. A client can be tampered with, so we never
// trust it — we check the user's subscription here, on every sync request.
//
// Sync is allowed only when subscription_status = 'active' AND the subscription
// has not expired (subscription_expires_at is null = no expiry, or in the future).
// Otherwise we refuse with 402 Payment Required so the app can prompt to subscribe.
//
// Must sit AFTER requireAuth (needs req.userId).
export async function requireSubscription(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const [rows] = await pool.query(
      'SELECT subscription_status, subscription_expires_at FROM users WHERE id = ?',
      [req.userId]
    );
    const user = (rows as Row[])[0];
    if (!user) {
      return res.status(401).json({ error: 'user not found' });
    }

    const status = user.subscription_status;
    const expiresAt = user.subscription_expires_at
      ? new Date(user.subscription_expires_at as string)
      : null;
    const expired = expiresAt !== null && expiresAt.getTime() <= Date.now();

    if (status !== 'active' || expired) {
      return res.status(402).json({
        error: 'subscription inactive',
        subscription_status: status,
        subscription_expires_at: expiresAt ? expiresAt.toISOString() : null,
      });
    }

    next();
  } catch (err) {
    next(err);
  }
}
