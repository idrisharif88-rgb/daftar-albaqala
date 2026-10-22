import { Router, json } from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { pool } from '../db';
import { asyncHandler } from '../asyncHandler';
import { AuthedRequest } from '../middleware/auth';

const router = Router();

// Attachments — a file pinned to an entry (a product photo, a picture of the
// paper invoice, proof that a payment went through).
//
// Two things travel separately, on purpose:
//   - the METADATA row (id, which entry, mime, filename, size) syncs like every
//     other table — upsert by UUID, soft-delete via deleted_at, delta by
//     server_updated_at. It is small and belongs in every delta.
//   - the BYTES live on disk under ATTACH_DIR, one file per attachment, and
//     move only on the upload/download endpoints below. A megabyte of JPEG has
//     no business in a row that balance queries read, and base64 in the JSON
//     sync body would blow past its size limit.
//
// Transport for the bytes is base64 inside a JSON body (not a raw binary
// stream): the native app routes HTTP through CapacitorHttp to dodge CORS, and
// CapacitorHttp is reliable with JSON but fiddly with binary request/response
// bodies. Images are compressed on the phone before upload, so the inflation
// base64 costs is paid on a payload already shrunk to a few hundred KB.
//
// TENANT ISOLATION (#1 risk): every query filters by req.userId, an upload is
// refused unless the target transaction belongs to this owner, and an id that
// already exists under another owner is rejected — never overwritten.

// What a client may upload. The column is permissive; this is the gate.
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
]);

// Largest stored file. The phone compresses images well below this; the ceiling
// is really there for PDFs and as a denial-of-service bound on one request.
const MAX_BYTES = 12 * 1024 * 1024;

// Where the bytes live. Overridden in server/.env on the droplet (a path OUTSIDE
// the git clone, so `git pull` never touches it); defaults under the process's
// working directory for local dev + tests.
const ATTACH_DIR = process.env.ATTACH_DIR || path.join(process.cwd(), 'data', 'attachments');

const META_COLS =
  'id, transaction_id, mime, filename, size, created_at, deleted_at';

// One file per attachment, foldered by owner so a stray listing can't mix two
// tenants and a per-account purge is one `rm -rf <user_id>`.
function filePathFor(userId: string, id: string): string {
  return path.join(ATTACH_DIR, userId, id);
}

async function writeBytes(userId: string, id: string, buf: Buffer): Promise<void> {
  const dir = path.join(ATTACH_DIR, userId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePathFor(userId, id), buf);
}

// GET /attachments?transaction_id=...  → active files on one entry
// GET /attachments?since=<iso>         → metadata delta (incl. tombstones)
router.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { transaction_id, since } = req.query;

    if (typeof transaction_id === 'string' && transaction_id) {
      const [rows] = await pool.query(
        `SELECT ${META_COLS} FROM attachments
           WHERE user_id = ? AND transaction_id = ? AND deleted_at IS NULL
           ORDER BY created_at ASC`,
        [req.userId, transaction_id],
      );
      return res.json({ attachments: rows });
    }

    // Delta pull. Strictly-greater than the client's cursor; ties at the same
    // millisecond are all returned by one query (no paging), so none is split
    // across a page boundary and lost. Tombstones are included so a removal
    // reaches the other devices. An empty `since` means "from the beginning",
    // the same as none — a blank string is not a timestamp.
    const cursor = typeof since === 'string' && since ? since : null;
    const [rows] = await pool.query(
      `SELECT ${META_COLS}, server_updated_at FROM attachments
         WHERE user_id = ? AND (? IS NULL OR server_updated_at > ?)
         ORDER BY server_updated_at ASC
         LIMIT 1000`,
      [req.userId, cursor, cursor],
    );
    const list = rows as Array<Record<string, unknown>>;
    // The next cursor is the newest stamp we actually returned; if nothing came
    // back, hold the caller's cursor where it was.
    const last = list.length ? list[list.length - 1].server_updated_at : null;
    const syncedAt = last != null ? new Date(last as string).toISOString() : cursor;
    // Strip the internal clock before replying — the client treats synced_at as
    // opaque and never sees server_updated_at on the other tables either.
    for (const r of list) delete r.server_updated_at;
    return res.json({ attachments: list, synced_at: syncedAt });
  }),
);

// GET /attachments/:id  → metadata + the bytes as base64
router.get(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const [rows] = await pool.query(
      `SELECT ${META_COLS} FROM attachments
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [req.params.id, req.userId],
    );
    const meta = (rows as Array<Record<string, unknown>>)[0];
    if (!meta) return res.status(404).json({ error: 'attachment not found' });

    let data: string;
    try {
      const buf = await fs.readFile(filePathFor(String(req.userId), req.params.id));
      data = buf.toString('base64');
    } catch {
      // Row exists but its bytes are gone from disk — a half-finished upload or
      // a manual cleanup. Say so rather than returning an empty file.
      return res.status(410).json({ error: 'attachment bytes unavailable' });
    }
    return res.json({ attachment: meta, data });
  }),
);

// POST /attachments  { id, transaction_id, mime, filename, size, data(base64) }
// Idempotent: re-sending the same id (its bytes already stored) is a success.
// A bigger JSON limit than the global 2 MB applies here — see the mount in app.ts.
router.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { id, transaction_id, mime, filename, data } = req.body ?? {};

    if (!transaction_id || typeof transaction_id !== 'string') {
      return res.status(400).json({ error: 'transaction_id is required' });
    }
    if (typeof mime !== 'string' || !ALLOWED_MIME.has(mime)) {
      return res.status(400).json({ error: 'unsupported file type' });
    }
    if (typeof data !== 'string' || data.length === 0) {
      return res.status(400).json({ error: 'data is required' });
    }

    let buf: Buffer;
    try {
      buf = Buffer.from(data, 'base64');
    } catch {
      return res.status(400).json({ error: 'data is not valid base64' });
    }
    if (buf.length === 0) return res.status(400).json({ error: 'data is empty' });
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'file too large' });

    // The entry must be this owner's, and still live. This is the gate that
    // stops an attachment being hung off another tenant's id.
    const [txns] = await pool.query(
      `SELECT id FROM transactions
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [transaction_id, req.userId],
    );
    if ((txns as unknown[]).length === 0) {
      return res.status(404).json({ error: 'transaction not found' });
    }

    const attId = id ? String(id) : randomUUID();

    // If the id already exists, it must be ours — never clobber another owner's.
    const [existing] = await pool.query(
      `SELECT user_id FROM attachments WHERE id = ?`,
      [attId],
    );
    const owner = (existing as Array<{ user_id: string }>)[0];
    if (owner && owner.user_id !== req.userId) {
      return res.status(409).json({ error: 'id belongs to another account' });
    }

    await writeBytes(String(req.userId), attId, buf);

    const cleanName = typeof filename === 'string' ? filename.slice(0, 255) : '';
    const now = new Date();
    // Upsert: a re-pushed id refreshes the row (and clears any tombstone) rather
    // than failing. server_updated_at advances via ON UPDATE.
    await pool.query(
      `INSERT INTO attachments
         (id, user_id, transaction_id, mime, filename, size, created_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE
         mime = VALUES(mime), filename = VALUES(filename), size = VALUES(size),
         deleted_at = NULL`,
      [attId, req.userId, transaction_id, mime, cleanName, buf.length, now],
    );

    const [rows] = await pool.query(
      `SELECT ${META_COLS} FROM attachments WHERE id = ? AND user_id = ?`,
      [attId, req.userId],
    );
    return res.status(201).json({ attachment: (rows as unknown[])[0] });
  }),
);

// DELETE /attachments/:id — soft-delete (a tombstone that syncs) and reclaim the
// disk. Idempotent: deleting an unknown or already-deleted id is a 200.
router.delete(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const [result] = await pool.query(
      `UPDATE attachments SET deleted_at = ?
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [new Date(), req.params.id, req.userId],
    );
    // Drop the bytes whether or not the row changed — a device that already
    // downloaded keeps its own copy, and a device that learns of the tombstone
    // never fetches. Missing file is fine.
    await fs.unlink(filePathFor(String(req.userId), req.params.id)).catch(() => {});
    return res.json({ deleted: true, changed: (result as { affectedRows?: number }).affectedRows ?? 0 });
  }),
);

export default router;

// A JSON parser with a larger ceiling than the app-wide 2 MB — one upload body
// is a base64 image or PDF. Exported so app.ts mounts it on this router only,
// not globally (the global limit is a DoS control the sync path relies on).
export const attachmentsBodyParser = json({ limit: '20mb' });
