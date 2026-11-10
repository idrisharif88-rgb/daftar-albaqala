import { getDB, persist } from '../../data/db';
import { uuidv4 } from '../../data/uuid';
import { localDay } from './day';
import { kickPosSync } from './posSyncKick';

// POS notes — short messages written at the point of sale («نفد الكيس الكبير»,
// «الزبون فلان سيمر بعد الظهر»). The owner and every staff member holding the
// `notes` permission read and write them; only the owner deletes one.
//
// Add-only, like the rest of the POS data: a note's text is never edited.
// A deletion is a tombstone (deleted_at), so it reaches every phone.
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
  /** Not yet acknowledged by the server. */
  pending: boolean;
}

export async function listNotes(): Promise<PosNote[]> {
  const db = await getDB();
  const res = await db.query(
    `SELECT id, author_staff_id, author_name, day, body, created_at, synced FROM pos_notes
      WHERE deleted_at IS NULL ORDER BY created_at DESC`,
  );
  return ((res.values ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    authorStaffId: r.author_staff_id ? String(r.author_staff_id) : null,
    authorName: String(r.author_name ?? ''),
    day: String(r.day),
    body: String(r.body),
    createdAt: String(r.created_at),
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

/** The owner's delete — a tombstone that syncs. (The server refuses a staff
 *  member's deletion; the screen does not offer one.) */
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
