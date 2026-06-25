import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from '../asyncHandler';
import { AuthedRequest } from '../middleware/auth';

const router = Router();

// All routes behind requireAuth (mounted in index.ts), so req.userId is set.
// SYNC = the phone uploads what it created/changed while offline; the server
// merges it. Two merge rules (see CLAUDE.md):
//   - customers    → upsert by UUID, LAST-WRITE-WINS by updated_at.
//   - transactions → APPEND-ONLY, insert only if the UUID isn't already stored.
// The whole push is IDEMPOTENT: re-sending the same batch changes nothing, so a
// flaky connection can retry safely.
//
// TENANT ISOLATION (#1 risk): a client could send a UUID that belongs to ANOTHER
// owner. We must never read or write across owners, so every record is checked
// against req.userId and any cross-owner id is rejected, never applied.

type Row = Record<string, unknown>;

// POST /sync/push — body: { customers: [...], transactions: [...] }
// Returns per-table counts so the client knows what landed.
router.post(
  '/push',
  asyncHandler(async (req: AuthedRequest, res) => {
    const customers: Row[] = Array.isArray(req.body?.customers) ? req.body.customers : [];
    const transactions: Row[] = Array.isArray(req.body?.transactions) ? req.body.transactions : [];

    const result = {
      customers: { inserted: 0, updated: 0, skipped: 0, rejected: 0 },
      transactions: { inserted: 0, skipped: 0, rejected: 0 },
    };

    // Run the whole batch in one DB transaction: either the merge commits as a
    // unit or it rolls back, so a mid-batch error can't leave a half-synced state.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // ---- customers: upsert, last-write-wins by updated_at ----
      for (const c of customers) {
        const id = c.id ? String(c.id) : '';
        const name = c.name !== undefined && c.name !== null ? String(c.name).trim() : '';
        const phone = c.phone !== undefined && c.phone !== null ? String(c.phone).trim() : '';
        if (!id || !name || !phone) {
          result.customers.rejected++;
          continue;
        }
        const updatedAt = c.updated_at ? new Date(c.updated_at as string) : new Date();
        const createdAt = c.created_at ? new Date(c.created_at as string) : updatedAt;
        const note = c.note ?? null;
        const deletedAt = c.deleted_at ? new Date(c.deleted_at as string) : null;

        const [rows] = await conn.query(
          'SELECT user_id, updated_at FROM customers WHERE id = ?',
          [id]
        );
        const existing = (rows as Row[])[0];

        if (!existing) {
          await conn.query(
            `INSERT INTO customers
               (id, user_id, name, phone, note, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, req.userId, name, phone, note, createdAt, updatedAt, deletedAt]
          );
          result.customers.inserted++;
        } else if (existing.user_id !== req.userId) {
          // UUID belongs to another owner — never touch it.
          result.customers.rejected++;
        } else if (updatedAt < new Date(existing.updated_at as string)) {
          // Stale offline edit — server already has a newer version.
          result.customers.skipped++;
        } else {
          await conn.query(
            `UPDATE customers
               SET name = ?, phone = ?, note = ?, updated_at = ?, deleted_at = ?
             WHERE id = ? AND user_id = ?`,
            [name, phone, note, updatedAt, deletedAt, id, req.userId]
          );
          result.customers.updated++;
        }
      }

      // ---- transactions: append-only, insert if the UUID is new ----
      for (const t of transactions) {
        const id = t.id ? String(t.id) : '';
        const customerId = t.customer_id ? String(t.customer_id) : '';
        const type = t.type;
        const amt = Number(t.amount);
        if (!id || !customerId || (type !== 'debt' && type !== 'payment') ||
            !Number.isFinite(amt) || amt <= 0) {
          result.transactions.rejected++;
          continue;
        }

        // Already stored? Append-only + idempotent → skip (no update, ever).
        const [existsRows] = await conn.query(
          'SELECT id FROM transactions WHERE id = ?',
          [id]
        );
        if ((existsRows as Row[]).length > 0) {
          result.transactions.skipped++;
          continue;
        }

        // The customer must belong to THIS owner (tenant isolation + valid FK).
        const [custRows] = await conn.query(
          'SELECT id FROM customers WHERE id = ? AND user_id = ?',
          [customerId, req.userId]
        );
        if ((custRows as Row[]).length === 0) {
          result.transactions.rejected++;
          continue;
        }

        const now = new Date();
        const occurredAt = t.occurred_at ? new Date(t.occurred_at as string) : now;
        const createdAt = t.created_at ? new Date(t.created_at as string) : now;
        await conn.query(
          `INSERT INTO transactions
             (id, user_id, customer_id, type, amount, note, occurred_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, req.userId, customerId, type, amt.toFixed(2), t.note ?? null, occurredAt, createdAt]
        );
        result.transactions.inserted++;
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    return res.json(result);
  })
);

// GET /sync/pull?since=<ISO timestamp> — return everything that changed on the
// server since the client's last sync, so a second device / reinstall catches up.
//   - customers    → rows with updated_at >= since. INCLUDES soft-deleted rows
//     (tombstones) so deletes propagate; the client reads deleted_at to apply them.
//   - transactions → rows with created_at >= since (append-only, never change).
// We use >= (not >) because DATETIME is second-precision: two rows can share a
// timestamp, so > could drop a same-second row. The small re-pull overlap at the
// boundary is harmless — the client applies pulled rows idempotently (LWW /
// insert-if-new), exactly like /sync/push. Missing a row would not be harmless,
// so we err toward overlap. Omitting `since` pulls everything (since = epoch).
// `synced_at` is the server clock the client stores as its next `since`.
router.get(
  '/pull',
  asyncHandler(async (req: AuthedRequest, res) => {
    const sinceParam = req.query.since;
    const since = sinceParam && typeof sinceParam === 'string'
      ? new Date(sinceParam)
      : new Date(0);
    if (Number.isNaN(since.getTime())) {
      return res.status(400).json({ error: 'since must be a valid ISO timestamp' });
    }

    const syncedAt = new Date();

    const [customers] = await pool.query(
      `SELECT id, name, phone, note, created_at, updated_at, deleted_at
         FROM customers
        WHERE user_id = ? AND updated_at >= ?
        ORDER BY updated_at ASC`,
      [req.userId, since]
    );

    const [transactions] = await pool.query(
      `SELECT id, customer_id, type, amount, note, occurred_at, created_at
         FROM transactions
        WHERE user_id = ? AND created_at >= ?
        ORDER BY created_at ASC`,
      [req.userId, since]
    );

    return res.json({ customers, transactions, synced_at: syncedAt.toISOString() });
  })
);

export default router;
