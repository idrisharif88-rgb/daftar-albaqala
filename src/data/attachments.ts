import { getDB, persist } from './db';
import { uuidv4 } from './uuid';
import {
  downloadAttachment, uploadAttachment, deleteAttachmentRemote, ApiError,
} from '../lib/api';

// Attachment repository — a file pinned to ONE entry (a product photo, a
// picture of the paper invoice, proof that a payment went through).
//
// The bytes are kept locally in `data` as base64 rather than on the filesystem:
// images are compressed before they get here (see lib/imageCompress.ts), so a
// column is big enough, and one code path then works the same on web and on the
// phone with no Filesystem/plugin divergence. A row pulled from the server
// arrives with `data` NULL — the bytes are fetched the first time the file is
// opened (`getAttachmentData`), not eagerly, so a long history does not drag a
// megabyte down per entry.
//
// Same local conventions as the rest of the data layer: UUID text PK, ISO-8601
// UTC text timestamps, soft-delete + a `synced` dirty flag. `uploaded` marks a
// row the server has already stored, so the sync pass knows whether a deletion
// needs a DELETE pushed or the row can simply be dropped.

export interface Attachment {
  id: string;
  transaction_id: string;
  mime: string;
  filename: string;
  size: number;
  /** base64, or null when the bytes live only on the server so far. */
  data: string | null;
  created_at: string;
  deleted_at: string | null;
}

const COLS = 'id, transaction_id, mime, filename, size, data, created_at, deleted_at';
const META = 'id, transaction_id, mime, filename, size, created_at, deleted_at'; // no bytes
const nowIso = () => new Date().toISOString();

function toAttachment(row: Record<string, unknown>): Attachment {
  return {
    id: String(row.id),
    transaction_id: String(row.transaction_id),
    mime: String(row.mime),
    filename: String(row.filename ?? ''),
    size: Number(row.size) || 0,
    data: (row.data as string | null) ?? null,
    created_at: String(row.created_at),
    deleted_at: (row.deleted_at as string | null) ?? null,
  };
}

/** Active attachments on one entry, oldest first — metadata only (no bytes), so
 *  a list of thumbnails doesn't pull every file into memory at once. */
export async function listAttachments(transactionId: string): Promise<Attachment[]> {
  const db = await getDB();
  const res = await db.query(
    `SELECT ${META} FROM attachments
      WHERE transaction_id = ? AND deleted_at IS NULL
      ORDER BY created_at ASC`,
    [transactionId],
  );
  return ((res.values ?? []) as Record<string, unknown>[]).map((r) => toAttachment({ ...r, data: null }));
}

/** How many active files each entry has, for the little paperclip badge. */
export async function attachmentCounts(): Promise<Map<string, number>> {
  const db = await getDB();
  const res = await db.query(
    `SELECT transaction_id, COUNT(*) AS n FROM attachments
      WHERE deleted_at IS NULL GROUP BY transaction_id`,
  );
  const map = new Map<string, number>();
  for (const r of (res.values ?? []) as Record<string, unknown>[]) {
    map.set(String(r.transaction_id), Number(r.n) || 0);
  }
  return map;
}

/** Record a new file against an entry. `data` is base64 (no data: prefix). */
export async function createAttachment(input: {
  transactionId: string;
  mime: string;
  data: string;
  filename?: string;
  size?: number;
}): Promise<Attachment> {
  if (!input.data) throw new Error('الملف فارغ');
  const db = await getDB();
  const id = uuidv4();
  const now = nowIso();
  const size = input.size ?? Math.floor((input.data.length * 3) / 4);
  await db.run(
    `INSERT INTO attachments
       (id, transaction_id, mime, filename, size, data, created_at, deleted_at, synced, uploaded)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, 0)`,
    [id, input.transactionId, input.mime, input.filename ?? '', size, input.data, now],
  );
  await persist();
  return {
    id, transaction_id: input.transactionId, mime: input.mime,
    filename: input.filename ?? '', size, data: input.data, deleted_at: null, created_at: now,
  };
}

// Soft-delete: a tombstone, so the removal reaches the other device instead of
// the file reappearing on the next pull. Kept until the next sync carries the
// DELETE; the sync pass drops the local row afterwards.
export async function softDeleteAttachment(id: string): Promise<void> {
  const db = await getDB();
  const now = nowIso();
  await db.run(
    `UPDATE attachments SET deleted_at = ?, synced = 0 WHERE id = ?`,
    [now, id],
  );
  await persist();
}

/**
 * The bytes for one attachment, as base64. Returns what is stored locally, and
 * otherwise downloads it from the server once and caches it. Returns null when
 * the bytes are neither here nor reachable (offline, never uploaded) — the
 * caller shows a "not available offline" state rather than a broken image.
 */
export async function getAttachmentData(id: string): Promise<string | null> {
  const db = await getDB();
  const res = await db.query(`SELECT data FROM attachments WHERE id = ?`, [id]);
  const row = (res.values ?? [])[0] as { data?: string | null } | undefined;
  if (!row) return null;
  if (row.data) return row.data;

  // Not here yet — fetch from the server and cache it.
  try {
    const remote = await downloadAttachment(id);
    if (!remote?.data) return null;
    await db.run(`UPDATE attachments SET data = ? WHERE id = ?`, [remote.data, id]);
    await persist();
    return remote.data;
  } catch {
    return null; // offline, or the bytes are gone server-side
  }
}

// ---- Sync (its own channel — NOT the JSON row sync). Best-effort; the caller
// (data/sync.ts) runs it after the entries are pushed, so a file's entry is
// already on the server when its upload checks ownership. ----

/** Push local changes: upload new files, delete tombstoned ones. */
export async function pushDirtyAttachments(): Promise<{ uploaded: number; failed: number }> {
  const db = await getDB();
  const res = await db.query(
    `SELECT ${COLS}, uploaded FROM attachments WHERE synced = 0`,
  );
  const rows = (res.values ?? []) as Array<Record<string, unknown>>;
  let uploaded = 0;
  let failed = 0;

  for (const r of rows) {
    const id = String(r.id);
    const deleted = (r.deleted_at as string | null) ?? null;
    const wasUploaded = Number(r.uploaded) === 1;

    try {
      if (deleted) {
        // A tombstone. Only tell the server if it ever had the file; then drop
        // the local row — a deleted row is invisible to every read anyway.
        if (wasUploaded) await deleteAttachmentRemote(id);
        await db.run(`DELETE FROM attachments WHERE id = ?`, [id]);
      } else {
        const data = (r.data as string | null) ?? null;
        if (!data) { await db.run(`UPDATE attachments SET synced = 1 WHERE id = ?`, [id]); continue; }
        await uploadAttachment({
          id,
          transaction_id: String(r.transaction_id),
          mime: String(r.mime),
          filename: String(r.filename ?? ''),
          data,
        });
        await db.run(`UPDATE attachments SET synced = 1, uploaded = 1 WHERE id = ?`, [id]);
        uploaded++;
      }
    } catch (err) {
      // A transaction the server hasn't accepted yet (404) just means its
      // contact or the entry is still in flight — leave the row dirty and it
      // goes again next run. A 402 bubbles up so the whole sync reports it.
      if (err instanceof ApiError && err.status === 402) throw err;
      failed++;
    }
  }
  await persist();
  return { uploaded, failed };
}

/** Apply a metadata row pulled from the server. New rows arrive without bytes
 *  (downloaded lazily); a tombstone drops the local copy and its bytes. */
export async function applyServerAttachment(row: {
  id: string; transaction_id: string; mime: string; filename: string | null;
  size: number; created_at: string; deleted_at: string | null;
}): Promise<void> {
  const db = await getDB();
  if (row.deleted_at) {
    await db.run(`DELETE FROM attachments WHERE id = ?`, [row.id]);
    return;
  }
  const res = await db.query(`SELECT id FROM attachments WHERE id = ?`, [row.id]);
  const exists = (res.values ?? []).length > 0;
  if (exists) {
    await db.run(
      `UPDATE attachments SET transaction_id = ?, mime = ?, filename = ?, size = ?,
              synced = 1, uploaded = 1 WHERE id = ?`,
      [row.transaction_id, row.mime, row.filename ?? '', row.size, row.id],
    );
  } else {
    await db.run(
      `INSERT INTO attachments
         (id, transaction_id, mime, filename, size, data, created_at, deleted_at, synced, uploaded)
       VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, 1, 1)`,
      [row.id, row.transaction_id, row.mime, row.filename ?? '', row.size, row.created_at],
    );
  }
}
