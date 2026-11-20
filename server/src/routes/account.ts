import { Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { AuthedRequest } from '../middleware/auth';
import { eraseAccount } from '../account/erase';
import { publish } from '../live/hub';
import { pool } from '../db';
import { verifyCode } from '../account/phoneVerification';

const router = Router();

// The account itself: for now, the one thing an owner can do to it — end it.
//
// Google Play requires that an app which lets people CREATE an account lets
// them delete it from inside the app, not only by writing to a support address.
// That is also simply right: the book holds other people's names, numbers and
// debts, and the person who typed them in should be able to take them back
// without asking anyone's permission.
//
// Mounted behind requireAuth but deliberately NOT behind requireSubscription.
// An account that was never activated is the one most likely to be deleted, and
// gating deletion on the same flag that blocked the account would trap someone
// in an account they cannot use and cannot leave.

// DELETE /account — erase this owner and everything of theirs.
//
// A HARD delete, not a tombstone. Tombstones exist in this schema so that a
// deletion PROPAGATES to another device; there is no device left to propagate
// to, and a "deleted" account whose rows are still in the table has not been
// deleted in the sense the person meant, or in the sense Play means.
router.delete(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    // The token stays technically valid until it expires, but it now names a
    // user who does not exist — every authenticated route reads the row and
    // finds nothing. The client throws it away as well.
    return res.json({ deleted: await eraseAccount(String(req.userId)) });
  })
);

// POST /account/sync-consent  { approve: boolean }
// The shopkeeper's own answer to «may your book be kept on the server?». Only
// this route — behind requireAuth, so only the book's OWNER (a staff token is
// refused there) — can set 'approved'; the Watcher can only ask. 'rejected'
// is also how an approval is WITHDRAWN later, from Settings: sync stops on the
// next request (requireSubscription).
router.post(
  '/sync-consent',
  asyncHandler(async (req: AuthedRequest, res) => {
    const approve = req.body?.approve;
    if (typeof approve !== 'boolean') {
      return res.status(400).json({ error: 'approve must be true or false' });
    }
    const consent = approve ? 'approved' : 'rejected';
    const [result] = await pool.query(
      'UPDATE users SET sync_consent = ?, sync_consent_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP() WHERE id = ?',
      [consent, req.userId]
    );
    if ((result as { affectedRows?: number }).affectedRows !== 1) {
      return res.status(404).json({ error: 'user not found' });
    }
    publish('admin', 'consent', { id: req.userId, sync_consent: consent }); // the Watcher sees the answer at once
    return res.json({ sync_consent: consent });
  })
);

// GET /account/logo → { logo: data URL | null, at }
// The shop's own logo (set in the Watcher). /me carries only `brand_logo_at`,
// so the app downloads the image only when it changed.
router.get(
  '/logo',
  asyncHandler(async (req: AuthedRequest, res) => {
    const [rows] = await pool.query('SELECT brand_logo, brand_logo_at FROM users WHERE id = ?', [req.userId]);
    const row = (rows as Array<{ brand_logo: string | null; brand_logo_at: Date | null }>)[0];
    if (!row) return res.status(404).json({ error: 'user not found' });
    return res.json({ logo: row.brand_logo, at: row.brand_logo_at });
  })
);

// POST /account/verify-phone  { code }
// The user types the code the developer sent to their number. Behind
// requireAuth only (not requireSubscription): an unverified account is exactly
// the one that has no sync yet.
//   200 { verified: true }                 — done (the Watcher hears at once)
//   400 { error: 'wrong code', attempts_left }
//   410 { error: 'code expired' | 'too many attempts' } — ask for a new code
//   404 { error: 'no code' }               — none was issued
//   409 { error: 'already verified' }
router.post(
  '/verify-phone',
  asyncHandler(async (req: AuthedRequest, res) => {
    const r = await verifyCode(String(req.userId), req.body?.code);
    if (r.ok) {
      publish('admin', 'verified', { id: req.userId });
      publish(`user:${req.userId}`, 'access');
      return res.json({ verified: true });
    }
    switch (r.reason) {
      case 'wrong': return res.status(400).json({ error: 'wrong code', attempts_left: r.attempts_left });
      case 'expired': return res.status(410).json({ error: 'code expired' });
      case 'locked': return res.status(410).json({ error: 'too many attempts' });
      case 'already': return res.status(409).json({ error: 'already verified' });
      default: return res.status(404).json({ error: 'no code' });
    }
  })
);

export default router;
