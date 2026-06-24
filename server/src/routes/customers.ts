import { Router } from 'express';
import { randomUUID } from 'crypto';
import { pool } from '../db';
import { asyncHandler } from '../asyncHandler';
import { AuthedRequest } from '../middleware/auth';

const router = Router();

// All routes here sit behind requireAuth (mounted in index.ts), so req.userId
// is always set. EVERY query below filters by req.userId — tenant isolation is
// mandatory (see CLAUDE.md): a shopkeeper must never see another's customers.

// The columns we return to clients. Kept in one place so list/create/update agree.
const CUSTOMER_COLS = 'id, name, phone, note, created_at, updated_at';

// GET /customers — list this owner's customers (newest first), excluding soft-deleted.
router.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const [rows] = await pool.query(
      `SELECT ${CUSTOMER_COLS} FROM customers
       WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [req.userId]
    );
    return res.json({ customers: rows });
  })
);

// POST /customers — create a customer. Phone is required and must be unique
// among this owner's non-deleted customers (uniqueness enforced in the app
// layer, not a DB constraint — see CLAUDE.md). Accepts an optional client-made
// id (UUID) so records created offline keep their id when they reach the server.
router.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { id, name, phone, note } = req.body ?? {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!phone || !String(phone).trim()) {
      return res.status(400).json({ error: 'phone is required' });
    }

    const cleanName = String(name).trim();
    const cleanPhone = String(phone).trim();

    // Reject a duplicate phone among this owner's active customers.
    const [dupes] = await pool.query(
      `SELECT id FROM customers
       WHERE user_id = ? AND phone = ? AND deleted_at IS NULL`,
      [req.userId, cleanPhone]
    );
    if ((dupes as unknown[]).length > 0) {
      return res.status(409).json({ error: 'a customer with this phone already exists' });
    }

    const customerId = id ? String(id) : randomUUID();
    const now = new Date();

    await pool.query(
      `INSERT INTO customers (id, user_id, name, phone, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [customerId, req.userId, cleanName, cleanPhone, note ?? null, now, now]
    );

    const [rows] = await pool.query(
      `SELECT ${CUSTOMER_COLS} FROM customers WHERE id = ? AND user_id = ?`,
      [customerId, req.userId]
    );
    return res.status(201).json({ customer: (rows as unknown[])[0] });
  })
);

// PUT /customers/:id — update name/phone/note. Last-write-wins by updated_at:
// we only apply the change if the incoming updated_at is newer than the stored
// one (or none is provided), so a stale offline edit can't clobber a fresh one.
router.put(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { name, phone, note, updated_at } = req.body ?? {};

    const [rows] = await pool.query(
      `SELECT id, name, phone, note, updated_at FROM customers
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [req.params.id, req.userId]
    );
    const existing = (rows as Array<Record<string, unknown>>)[0];
    if (!existing) {
      return res.status(404).json({ error: 'customer not found' });
    }

    // Last-write-wins: ignore an edit that is older than what we already have.
    const incoming = updated_at ? new Date(updated_at) : new Date();
    if (incoming < new Date(existing.updated_at as string)) {
      const [current] = await pool.query(
        `SELECT ${CUSTOMER_COLS} FROM customers WHERE id = ? AND user_id = ?`,
        [req.params.id, req.userId]
      );
      return res.json({ customer: (current as unknown[])[0], stale: true });
    }

    const newName = name !== undefined ? String(name).trim() : (existing.name as string);
    const newPhone = phone !== undefined ? String(phone).trim() : (existing.phone as string);
    const newNote = note !== undefined ? note : existing.note;

    if (!newName) return res.status(400).json({ error: 'name is required' });
    if (!newPhone) return res.status(400).json({ error: 'phone is required' });

    // If the phone changed, it must not collide with another active customer.
    if (newPhone !== existing.phone) {
      const [dupes] = await pool.query(
        `SELECT id FROM customers
         WHERE user_id = ? AND phone = ? AND deleted_at IS NULL AND id <> ?`,
        [req.userId, newPhone, req.params.id]
      );
      if ((dupes as unknown[]).length > 0) {
        return res.status(409).json({ error: 'a customer with this phone already exists' });
      }
    }

    await pool.query(
      `UPDATE customers SET name = ?, phone = ?, note = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [newName, newPhone, newNote ?? null, incoming, req.params.id, req.userId]
    );

    const [updated] = await pool.query(
      `SELECT ${CUSTOMER_COLS} FROM customers WHERE id = ? AND user_id = ?`,
      [req.params.id, req.userId]
    );
    return res.json({ customer: (updated as unknown[])[0] });
  })
);

// DELETE /customers/:id — soft-delete (set deleted_at). The row stays as a
// tombstone so the delete can sync to other devices. Transactions are untouched.
router.delete(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const now = new Date();
    const [result] = await pool.query(
      `UPDATE customers SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [now, now, req.params.id, req.userId]
    );

    if ((result as { affectedRows: number }).affectedRows === 0) {
      return res.status(404).json({ error: 'customer not found' });
    }
    return res.json({ ok: true });
  })
);

export default router;
