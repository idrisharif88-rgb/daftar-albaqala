import { Router } from 'express';
import { randomUUID } from 'crypto';
import { pool } from '../db';
import { asyncHandler } from '../asyncHandler';
import { PosRequest } from '../middleware/posActor';
import { publish } from '../live/hub';

/** Tell both ends of a conversation to look again (live line). */
function ping(ownerId: string, staffId: string): void {
  publish(`user:${ownerId}`, 'chat', { staff_id: staffId });
  publish(`staff:${staffId}`, 'chat', {});
}

// Private chat between the shop OWNER and each staff member — one conversation
// per member, text only, online (nothing is kept on the phones). Mounted
// behind requirePosActor + the shop's staff switch (app.ts).
//
// Who sees what — enforced HERE, on every request:
//   - the owner: every conversation of his own staff (`:staffId` must be his);
//   - a staff member: only their own (`:staffId` must be `me` or their id).
// Every query is scoped by owner_id (= req.userId, the owner even for staff).

const router = Router();
type Row = Record<string, unknown>;
export const MESSAGE_MAX = 1000;
const PAGE = 200;

/** The conversation this request may open, or null. */
async function threadOf(req: PosRequest, param: string): Promise<string | null> {
  if (req.staff) return param === 'me' || param === req.staff.id ? req.staff.id : null;
  const [rows] = await pool.query('SELECT id FROM pos_staff WHERE id = ? AND owner_id = ?', [param, req.userId]);
  return (rows as Row[]).length ? param : null;
}

// GET /pos-chat/threads — the owner's list: each member, last message, unread.
router.get(
  '/threads',
  asyncHandler(async (req: PosRequest, res) => {
    if (req.staff) return res.status(403).json({ error: 'owner only' });
    const [rows] = await pool.query(
      `SELECT s.id AS staff_id, s.name, s.disabled_at,
              (SELECT body FROM pos_messages m WHERE m.owner_id = s.owner_id AND m.staff_id = s.id
                ORDER BY created_at DESC LIMIT 1) AS last_body,
              (SELECT MAX(created_at) FROM pos_messages m WHERE m.owner_id = s.owner_id AND m.staff_id = s.id) AS last_at,
              (SELECT COUNT(*) FROM pos_messages m WHERE m.owner_id = s.owner_id AND m.staff_id = s.id
                 AND m.from_staff = 1 AND m.read_at IS NULL) AS unread
         FROM pos_staff s WHERE s.owner_id = ?
        ORDER BY last_at IS NULL, last_at DESC, s.created_at`,
      [req.userId],
    );
    return res.json({
      threads: (rows as Row[]).map((r) => ({
        staff_id: r.staff_id, name: r.name, disabled: r.disabled_at !== null,
        last_body: r.last_body ?? null, last_at: r.last_at ?? null, unread: Number(r.unread),
      })),
    });
  }),
);

// GET /pos-chat/unread — the badge on the chat tab: messages from the other side not yet read.
router.get(
  '/unread',
  asyncHandler(async (req: PosRequest, res) => {
    const [rows] = req.staff
      ? await pool.query(
        'SELECT COUNT(*) AS n FROM pos_messages WHERE owner_id = ? AND staff_id = ? AND from_staff = 0 AND read_at IS NULL',
        [req.userId, req.staff.id])
      : await pool.query(
        'SELECT COUNT(*) AS n FROM pos_messages WHERE owner_id = ? AND from_staff = 1 AND read_at IS NULL',
        [req.userId]);
    return res.json({ unread: Number((rows as Row[])[0].n) });
  }),
);

// GET /pos-chat/:staffId/messages — the last PAGE messages, oldest first.
router.get(
  '/:staffId/messages',
  asyncHandler(async (req: PosRequest, res) => {
    const staffId = await threadOf(req, req.params.staffId);
    if (!staffId) return res.status(404).json({ error: 'conversation not found' });
    const [rows] = await pool.query(
      `SELECT id, from_staff, body, created_at, read_at FROM (
         SELECT id, from_staff, body, created_at, read_at FROM pos_messages
          WHERE owner_id = ? AND staff_id = ? ORDER BY created_at DESC LIMIT ?) t
        ORDER BY created_at`,
      [req.userId, staffId, PAGE],
    );
    return res.json({
      messages: (rows as Row[]).map((m) => ({
        id: m.id, from_staff: Number(m.from_staff) === 1, body: m.body, created_at: m.created_at, read_at: m.read_at ?? null,
      })),
    });
  }),
);

// POST /pos-chat/:staffId/messages { body } — the sender is decided by the token.
router.post(
  '/:staffId/messages',
  asyncHandler(async (req: PosRequest, res) => {
    const staffId = await threadOf(req, req.params.staffId);
    if (!staffId) return res.status(404).json({ error: 'conversation not found' });
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body || body.length > MESSAGE_MAX) return res.status(400).json({ error: `body must be 1–${MESSAGE_MAX} characters` });
    const id = randomUUID();
    await pool.query(
      'INSERT INTO pos_messages (id, owner_id, staff_id, from_staff, body) VALUES (?, ?, ?, ?, ?)',
      [id, req.userId, staffId, req.staff ? 1 : 0, body],
    );
    ping(req.userId!, staffId); // the other side sees it at once
    return res.status(201).json({ id });
  }),
);

// POST /pos-chat/:staffId/read — marks what the OTHER side wrote as read.
router.post(
  '/:staffId/read',
  asyncHandler(async (req: PosRequest, res) => {
    const staffId = await threadOf(req, req.params.staffId);
    if (!staffId) return res.status(404).json({ error: 'conversation not found' });
    await pool.query(
      'UPDATE pos_messages SET read_at = NOW(3) WHERE owner_id = ? AND staff_id = ? AND from_staff = ? AND read_at IS NULL',
      [req.userId, staffId, req.staff ? 0 : 1],
    );
    ping(req.userId!, staffId); // the sender's «أُرسلت» turns into «قُرئت» at once
    return res.json({ ok: true });
  }),
);

export default router;
