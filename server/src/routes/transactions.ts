import { Router } from 'express';
import { randomUUID } from 'crypto';
import { pool } from '../db';
import { asyncHandler } from '../asyncHandler';
import { AuthedRequest } from '../middleware/auth';
import { DEFAULT_CURRENCY, VALID_CURRENCIES } from '../domain';

const router = Router();

// All routes behind requireAuth (mounted in index.ts), so req.userId is set.
// EVERY query filters by req.userId (tenant isolation — see CLAUDE.md).
// Transactions are APPEND-ONLY: no update, no delete. A correction is a new
// reversing entry, never an edit of the original.

const TXN_COLS = 'id, customer_id, type, amount, currency, note, occurred_at, created_at';

// GET /transactions?customer_id=... — list transactions for one of this owner's
// customers, newest occurrence first. customer_id is required.
router.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const customerId = req.query.customer_id;
    if (!customerId || typeof customerId !== 'string') {
      return res.status(400).json({ error: 'customer_id query parameter is required' });
    }

    const [rows] = await pool.query(
      `SELECT ${TXN_COLS} FROM transactions
       WHERE user_id = ? AND customer_id = ?
       ORDER BY occurred_at DESC, created_at DESC`,
      [req.userId, customerId]
    );
    return res.json({ transactions: rows });
  })
);

// POST /transactions — record a debt or payment. Append-only. The customer must
// belong to this owner and not be soft-deleted. Accepts an optional client-made
// id (UUID) so records created offline keep their id when they reach the server.
router.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { id, customer_id, type, amount, currency, note, occurred_at } = req.body ?? {};

    if (!customer_id) {
      return res.status(400).json({ error: 'customer_id is required' });
    }
    if (type !== 'debt' && type !== 'payment') {
      return res.status(400).json({ error: "type must be 'debt' or 'payment'" });
    }
    // amount must be a positive number (the type — debt/payment — carries the sign).
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    // What was owed — riyals, hard currency, or grams of gold. The native
    // currency IS the debt of record, so an unrecognised code is refused rather
    // than defaulted: quietly filing a gold debt as riyals would corrupt it.
    const cur = currency === undefined || currency === null
      ? DEFAULT_CURRENCY
      : String(currency);
    if (!VALID_CURRENCIES.has(cur)) {
      return res.status(400).json({ error: 'currency must be one of YER, SAR, USD, GOLD' });
    }

    // Verify the customer belongs to this owner and is active. This both enforces
    // tenant isolation and prevents attaching a transaction to a deleted customer.
    const [custRows] = await pool.query(
      `SELECT id FROM customers
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [customer_id, req.userId]
    );
    if ((custRows as unknown[]).length === 0) {
      return res.status(404).json({ error: 'customer not found' });
    }

    const txnId = id ? String(id) : randomUUID();
    const now = new Date();
    // occurred_at is when the debt/payment actually happened (user-chosen);
    // default to now if the client didn't provide it.
    const occurredAt = occurred_at ? new Date(occurred_at) : now;

    await pool.query(
      `INSERT INTO transactions
         (id, user_id, customer_id, type, amount, currency, note, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [txnId, req.userId, customer_id, type, amt.toFixed(2), cur, note ?? null, occurredAt, now]
    );

    const [rows] = await pool.query(
      `SELECT ${TXN_COLS} FROM transactions WHERE id = ? AND user_id = ?`,
      [txnId, req.userId]
    );
    return res.status(201).json({ transaction: (rows as unknown[])[0] });
  })
);

export default router;
