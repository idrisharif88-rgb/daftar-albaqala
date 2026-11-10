import fs from 'fs/promises';
import path from 'path';
import { pool } from '../db';

const ATTACH_DIR = process.env.ATTACH_DIR || path.join(process.cwd(), 'data', 'attachments');

/**
 * Erase one owner and everything of theirs — a HARD delete. Used by the owner
 * himself (DELETE /account) and by the Watcher (DELETE /admin/users/:id), so
 * both remove exactly the same rows. Resolves whether the user row existed.
 *
 * Children before parents: every table here has a foreign key onto customers
 * or users, so the wrong order fails on the constraint and rolls everything
 * back. Every statement is filtered by user_id — the bug that leaks one
 * owner's data is bad, the bug that erases another owner's book is
 * unrecoverable.
 */
export async function eraseAccount(userId: string): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Attachments first: they hold a foreign key onto transactions.
    await conn.query('DELETE FROM attachments WHERE user_id = ?', [userId]);
    await conn.query('DELETE FROM transactions WHERE user_id = ?', [userId]);
    await conn.query('DELETE FROM item_groups WHERE user_id = ?', [userId]);
    await conn.query('DELETE FROM items WHERE user_id = ?', [userId]);
    await conn.query('DELETE FROM customers WHERE user_id = ?', [userId]);
    await conn.query('DELETE FROM user_settings WHERE user_id = ?', [userId]);
    // Point of sale: every table holds a foreign key onto users.
    await conn.query('DELETE FROM pos_staff WHERE owner_id = ?', [userId]);
    await conn.query('DELETE FROM pos_sales WHERE user_id = ?', [userId]);
    await conn.query('DELETE FROM pos_baked WHERE user_id = ?', [userId]);
    await conn.query('DELETE FROM pos_day_lock WHERE user_id = ?', [userId]);
    await conn.query('DELETE FROM pos_products WHERE user_id = ?', [userId]);
    const [result] = await conn.query('DELETE FROM users WHERE id = ?', [userId]);
    await conn.commit();
    // The rows are gone; reclaim the files. Best-effort and after the commit —
    // a leftover folder wastes space but never blocks the deletion.
    await fs.rm(path.join(ATTACH_DIR, userId), { recursive: true, force: true }).catch(() => {});
    return (result as { affectedRows?: number }).affectedRows === 1;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
