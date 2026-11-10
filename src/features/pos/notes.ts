import { getDB, persist } from '../../data/db';
import { uuidv4 } from '../../data/uuid';
import { localDay } from './day';
import { kickPosSync } from './posSyncKick';

// POS notes — short messages written at the point of sale («نفد الكيس الكبير»,
// «الزبون فلان سيمر بعد الظهر»). The owner and every staff member holding the
// `notes` permission read and write them. A note is EDITED or DELETED by the
// person who wrote it, or by the owner (the server refuses anyone else).
//
// An edit keeps the note's id and stamps edited_at (the last edit wins). A
// deletion is a tombstone (deleted_at), so it reaches every phone.
// Who wrote a note is set by the SERVER from the sender's token — a note
// written here shows its author once it has been through a sync.

export const NOTE_MAX = 1000;

export interface PosNote {
  id: string;
  /** null = the owner. */
  authorStaffId: string | null;
  authorName: string;
  day: string;
  body: string;
  createdAt: string;
  /** When its text was last changed; null = never edited. */
  editedAt: string | null;
  /** Not yet acknowledged by the server. */
  pending: boolean;
}

export async function listNotes(): Promise<PosNote[]> {
  const db = await getDB();
  const res = await db.query(
    `SELECT id, author_staff_id, author_name, day, body, edited_at, created_at, synced FROM pos_notes
      WHERE deleted_at IS NULL ORDER BY created_at DESC`,
  );
  return ((res.values ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    authorStaffId: r.author_staff_id ? String(r.author_staff_id) : null,
    authorName: String(r.author_name ?? ''),
    day: String(r.day),
    body: String(r.body),
    createdAt: String(r.created_at),
    editedAt: r.edited_at ? String(r.edited_at) : null,
    pending: Number(r.synced) === 0,
  }));
}

export async function addNote(text: string): Promise<void> {
  const body = text.trim();
  if (!body) throw new Error('اكتب الملاحظة أولاً');
  if (body.length > NOTE_MAX) throw new Error(`الملاحظة أطول من ${NOTE_MAX} حرف`);
  const db = await getDB();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO pos_notes (id, author_staff_id, author_name, day, body, created_at, updated_at, deleted_at, synced)
     VALUES (?, NULL, '', ?, ?, ?, ?, NULL, 0)`,
    [uuidv4(), localDay(), body, now, now],
  );
  await persist();
  kickPosSync();
}

/** Change a note's text — its author or the owner (the screen offers it only
 *  to them; the server checks again). */
export async function editNote(id: string, text: string): Promise<void> {
  const body = text.trim();
  if (!body) throw new Error('اكتب الملاحظة أولاً');
  if (body.length > NOTE_MAX) throw new Error(`الملاحظة أطول من ${NOTE_MAX} حرف`);
  const db = await getDB();
  const now = new Date().toISOString();
  await db.run(
    'UPDATE pos_notes SET body = ?, edited_at = ?, updated_at = ?, synced = 0 WHERE id = ? AND deleted_at IS NULL',
    [body, now, now, id],
  );
  await persist();
  kickPosSync();
}

/** Delete a note — its author or the owner. A tombstone that syncs. */
export async function deleteNote(id: string): Promise<void> {
  const db = await getDB();
  const now = new Date().toISOString();
  await db.run(
    'UPDATE pos_notes SET deleted_at = ?, updated_at = ?, synced = 0 WHERE id = ? AND deleted_at IS NULL',
    [now, now, id],
  );
  await persist();
  kickPosSync();
}
