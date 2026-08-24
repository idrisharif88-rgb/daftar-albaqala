import { getDB, persist } from './db';
import { uuidv4 } from './uuid';

// Saved baskets — «المجموعات».
//
// The owner buys the same handful of things from the same shop every week. The
// price list already made each of them one tap; a group makes the whole basket
// one tap. So a group is a NAMED SET OF LINES: which items, and how many of
// each.
//
// A group is a SHORTCUT, never a record. Applying one only fills the invoice
// screen — the owner still sees every line, still edits the quantities, and
// still confirms before anything is written to the ledger. Nothing here is
// append-only for that reason: a group can be renamed, re-saved and deleted
// freely, because deleting it deletes no debt.
//
// Membership lives in ONE column as JSON, not in a child table. The ids only
// ever travel together, and a second synced entity would bring its own
// tombstones, its own ordering against the parent, and its own way to arrive
// half-applied — a lot of machinery to store three ids. The ids are resolved
// against the contact's own price list when the group is read, so an item that
// was deleted in the meantime simply drops out of the basket.
//
// Same local conventions as the rest of the data layer: UUID text PK, ISO-8601
// UTC text timestamps, soft-delete + a `synced` dirty flag.

export interface GroupLine {
  item_id: string;
  qty: number;
}

export interface ItemGroup {
  id: string;
  customer_id: string;
  name: string;
  lines: GroupLine[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// `lines_json`, not `lines` — MySQL reserves that word, so the server's column
// is named this way and the phone matches it (see migrations.ts, migration 4).
const COLS = 'id, customer_id, name, lines_json, created_at, updated_at, deleted_at';
const nowIso = () => new Date().toISOString();

/** Parse the stored JSON defensively: a group with unreadable membership is
 *  still a group the owner should be able to see and delete, so it degrades to
 *  an empty basket rather than throwing on the way to the screen. */
function parseLines(raw: unknown): GroupLine[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((l) => {
        const line = l as { item_id?: unknown; qty?: unknown };
        return { item_id: String(line.item_id ?? ''), qty: Math.floor(Number(line.qty) || 0) };
      })
      .filter((l) => l.item_id !== '' && l.qty > 0);
  } catch {
    return [];
  }
}

function serializeLines(lines: GroupLine[]): string {
  return JSON.stringify(
    lines
      .filter((l) => l.item_id && l.qty > 0)
      .map((l) => ({ item_id: l.item_id, qty: Math.floor(l.qty) })),
  );
}

function toGroup(row: Record<string, unknown>): ItemGroup {
  return {
    id: String(row.id),
    customer_id: String(row.customer_id),
    name: String(row.name),
    lines: parseLines(row.lines_json),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    deleted_at: (row.deleted_at as string | null) ?? null,
  };
}

/** This contact's active groups, alphabetical. */
export async function listGroups(customerId: string): Promise<ItemGroup[]> {
  const db = await getDB();
  const res = await db.query(
    `SELECT ${COLS} FROM item_groups
      WHERE customer_id = ? AND deleted_at IS NULL
      ORDER BY name COLLATE NOCASE`,
    [customerId],
  );
  return ((res.values ?? []) as Record<string, unknown>[]).map(toGroup);
}

export async function getGroup(id: string): Promise<ItemGroup | null> {
  const db = await getDB();
  const res = await db.query(`SELECT ${COLS} FROM item_groups WHERE id = ?`, [id]);
  const row = (res.values ?? [])[0] as Record<string, unknown> | undefined;
  return row ? toGroup(row) : null;
}

/** True if this contact already has an active group by that name — two baskets
 *  called «الأسبوعية» are indistinguishable on the screen that offers them. */
export async function groupNameExists(
  customerId: string,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const db = await getDB();
  const res = await db.query(
    `SELECT id FROM item_groups
      WHERE customer_id = ? AND deleted_at IS NULL AND id <> ?
        AND name = ? COLLATE NOCASE`,
    [customerId, exceptId ?? '', name.trim()],
  );
  return (res.values ?? []).length > 0;
}

export async function createGroup(input: {
  customerId: string;
  name: string;
  lines: GroupLine[];
}): Promise<ItemGroup> {
  const name = input.name.trim();
  if (!name) throw new Error('اسم المجموعة مطلوب');
  const lines = input.lines.filter((l) => l.item_id && l.qty > 0);
  if (lines.length === 0) throw new Error('المجموعة فارغة');
  if (await groupNameExists(input.customerId, name)) throw new Error('المجموعة مسجلة مسبقاً');

  const db = await getDB();
  const id = uuidv4();
  const now = nowIso();
  await db.run(
    `INSERT INTO item_groups
       (id, customer_id, name, lines_json, created_at, updated_at, deleted_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 0)`,
    [id, input.customerId, name, serializeLines(lines), now, now],
  );
  await persist();
  return {
    id, customer_id: input.customerId, name, lines,
    created_at: now, updated_at: now, deleted_at: null,
  };
}

export async function updateGroup(
  id: string,
  fields: { name?: string; lines?: GroupLine[] },
): Promise<void> {
  const current = await getGroup(id);
  if (!current) throw new Error('المجموعة غير موجودة');

  const name = fields.name?.trim() ?? current.name;
  const lines = (fields.lines ?? current.lines).filter((l) => l.item_id && l.qty > 0);
  if (!name) throw new Error('اسم المجموعة مطلوب');
  if (lines.length === 0) throw new Error('المجموعة فارغة');
  if (await groupNameExists(current.customer_id, name, id)) {
    throw new Error('المجموعة مسجلة مسبقاً');
  }

  const db = await getDB();
  await db.run(
    `UPDATE item_groups SET name = ?, lines_json = ?, updated_at = ?, synced = 0 WHERE id = ?`,
    [name, serializeLines(lines), nowIso(), id],
  );
  await persist();
}

// Soft-delete, like an item: a tombstone, so the removal reaches the other
// device instead of the group reappearing on the next pull.
export async function deleteGroup(id: string): Promise<void> {
  const db = await getDB();
  const now = nowIso();
  await db.run(
    `UPDATE item_groups SET deleted_at = ?, updated_at = ?, synced = 0 WHERE id = ?`,
    [now, now, id],
  );
  await persist();
}

// ---- Sync helpers (mirroring items.ts; no persist() — the sync run flushes
// once at the end) ----

/** On the wire `lines_json` stays the JSON TEXT it is stored as: the server
 *  keeps it without reading inside it (see
 *  server/db/migrations/004_item_groups.sql). */
export interface WireGroup {
  id: string;
  customer_id: string;
  name: string;
  lines_json: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export async function getDirtyGroups(): Promise<WireGroup[]> {
  const db = await getDB();
  const res = await db.query(`SELECT ${COLS} FROM item_groups WHERE synced = 0`);
  return ((res.values ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    customer_id: String(row.customer_id),
    name: String(row.name),
    // Re-serialized from the parsed form, so a row that somehow holds malformed
    // JSON is repaired on its way out instead of being handed to the server.
    lines_json: serializeLines(parseLines(row.lines_json)),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    deleted_at: (row.deleted_at as string | null) ?? null,
  }));
}

export async function markGroupsSynced(rows: { id: string; updated_at: string }[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDB();
  for (const r of rows) {
    await db.run(
      `UPDATE item_groups SET synced = 1 WHERE id = ? AND updated_at = ?`,
      [r.id, r.updated_at],
    );
  }
}

/** Apply a group pulled from the server: insert if new, else last-write-wins by
 *  updated_at. Applied rows match the server, so they land synced = 1. */
export async function applyServerGroup(row: {
  id: string; customer_id: string; name: string; lines_json: string;
  created_at: string; updated_at: string; deleted_at: string | null;
}): Promise<void> {
  const db = await getDB();
  const existing = await getGroup(row.id);
  const lines = serializeLines(parseLines(row.lines_json));
  if (!existing) {
    await db.run(
      `INSERT INTO item_groups
         (id, customer_id, name, lines_json, created_at, updated_at, deleted_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [row.id, row.customer_id, row.name, lines,
       row.created_at, row.updated_at, row.deleted_at ?? null],
    );
  } else if (new Date(row.updated_at).getTime() > new Date(existing.updated_at).getTime()) {
    await db.run(
      `UPDATE item_groups SET customer_id = ?, name = ?, lines_json = ?, updated_at = ?,
              deleted_at = ?, synced = 1
        WHERE id = ?`,
      [row.customer_id, row.name, lines, row.updated_at, row.deleted_at ?? null, row.id],
    );
  }
}
