import { Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { AuthedRequest } from '../middleware/auth';
import { eraseAccount } from '../account/erase';
import { publish } from '../live/hub';
import { pool } from '../db';

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

export default router;
