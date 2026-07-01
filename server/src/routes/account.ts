import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from '../asyncHandler';
import { AuthedRequest } from '../middleware/auth';

const router = Router();

// Account self-service. Mounted behind requireAuth ONLY (not requireSubscription)
// — an inactive account is exactly the one that needs to ask to be activated, so
// it must not be gated by the subscription check.

// POST /account/request-activation — the grocer asks the owner to activate their
// account. We stamp the request time (and an optional note) on the user row; the
// owner then lists pending requests and flips subscription_status to 'active'.
//   Owner query (on the droplet):
//   SELECT phone, store_name, activation_requested_at, activation_message
//     FROM users
//    WHERE subscription_status <> 'active' AND activation_requested_at IS NOT NULL
//    ORDER BY activation_requested_at;
router.post(
  '/request-activation',
  asyncHandler(async (req: AuthedRequest, res) => {
    const raw = (req.body ?? {}).message;
    // Optional short note; trim and cap so it fits the VARCHAR(255) column.
    const message =
      raw == null || String(raw).trim() === '' ? null : String(raw).trim().slice(0, 255);
    const now = new Date();

    await pool.query(
      `UPDATE users
          SET activation_requested_at = ?, activation_message = ?, updated_at = ?
        WHERE id = ?`,
      [now, message, now, req.userId]
    );

    return res.json({ ok: true, requested_at: now.toISOString() });
  })
);

export default router;
