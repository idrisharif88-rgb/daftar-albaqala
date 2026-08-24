import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from '../asyncHandler';
import { AuthedRequest } from '../middleware/auth';

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
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Children before parents: every one of these has a foreign key onto
      // customers or users, so the order is not stylistic — the wrong one
      // fails on the constraint and rolls the whole thing back.
      //
      // Every statement is filtered by user_id. A DELETE is the least
      // forgiving place to get tenant isolation wrong: the bug that leaks one
      // owner's data is bad, the bug that erases another owner's book is
      // unrecoverable.
      await conn.query('DELETE FROM transactions WHERE user_id = ?', [req.userId]);
      await conn.query('DELETE FROM item_groups WHERE user_id = ?', [req.userId]);
      await conn.query('DELETE FROM items WHERE user_id = ?', [req.userId]);
      await conn.query('DELETE FROM customers WHERE user_id = ?', [req.userId]);
      await conn.query('DELETE FROM user_settings WHERE user_id = ?', [req.userId]);
      const [result] = await conn.query('DELETE FROM users WHERE id = ?', [req.userId]);

      await conn.commit();

      // The token stays technically valid until it expires, but it now names a
      // user who does not exist — every authenticated route reads the row and
      // finds nothing. The client throws it away as well.
      return res.json({
        deleted: (result as { affectedRows?: number }).affectedRows === 1,
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

export default router;
