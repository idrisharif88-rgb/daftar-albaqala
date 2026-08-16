import { getDB, persist } from './db';
import { uuidv4 } from './uuid';
import { BASE_CURRENCY, isCurrencyCode, type CurrencyCode } from './currencies';

// Item repository — the price list the owner keeps for ONE contact.
//
// Each shop gets its own list, on purpose: the same word means a different
// thing and costs a different amount at two different shops, and a single
// shared catalogue would make the owner scroll past every other shop's goods to
// find the one he is standing in front of. So an item belongs to a contact the
// way a transaction does, and deleting nothing is shared between them.
//
// An item is a PRICE, not stock. Nothing here counts what is on a shelf — the
// owner of this book is the one buying, not the one selling. The price is the
// last price paid, kept so that recording the same purchase again is a tap
// instead of a sum.
//
// Same local conventions as the rest of the data layer: UUID text PK, money in
// INTEGER minor units, ISO-8601 UTC text timestamps, soft-delete + `synced`.

export interface Item {
  id: string;
  customer_id: string;
  name: string;
  /** Minor units — see money.ts. */
  price: number;
  currency: CurrencyCode;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const COLS =
  'id, customer_id, name, price, currency, note, created_at, updated_at, deleted_at';
const nowIso = () => new Date().toISOString();

function toItem(row: Record<string, unknown>): Item {
  return {
    id: String(row.id),
    customer_id: String(row.customer_id),
    name: String(row.name),
    price: Number(row.price) || 0,
    currency: isCurrencyCode(row.currency) ? row.currency : BASE_CURRENCY,
    note: (row.note as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    deleted_at: (row.deleted_at as string | null) ?? null,
  };
}

/** This contact's active items, alphabetical. */
export async function listItems(customerId: string): Promise<Item[]> {
  const db = await getDB();
  const res = await db.query(
    `SELECT ${COLS} FROM items
      WHERE customer_id = ? AND deleted_at IS NULL
      ORDER BY name COLLATE NOCASE`,
    [customerId],
  );
  return ((res.values ?? []) as Record<string, unknown>[]).map(toItem);
}

export async function getItem(id: string): Promise<Item | null> {
  const db = await getDB();
  const res = await db.query(`SELECT ${COLS} FROM items WHERE id = ?`, [id]);
  const row = (res.values ?? [])[0] as Record<string, unknown> | undefined;
  return row ? toItem(row) : null;
}

/** True if this contact already has an active item by that name. Names are
 *  compared case-insensitively and trimmed — «سكر» typed twice is one item, and
 *  a duplicate would mean two prices for one thing with no way to tell which is
 *  current. */
export async function itemNameExists(
  customerId: string,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const db = await getDB();
  const res = await db.query(
    `SELECT id FROM items
      WHERE customer_id = ? AND deleted_at IS NULL AND id <> ?
        AND name = ? COLLATE NOCASE`,
    [customerId, exceptId ?? '', name.trim()],
  );
  return (res.values ?? []).length > 0;
}

export async function createItem(input: {
  customerId: string;
  name: string;
  price: number; // minor units
  currency?: CurrencyCode;
  note?: string | null;
}): Promise<Item> {
  const name = input.name.trim();
  if (!name) throw new Error('اسم الصنف مطلوب');
  if (!Number.isFinite(input.price) || input.price < 0) throw new Error('أدخل سعراً صحيحاً');
  if (await itemNameExists(input.customerId, name)) throw new Error('الصنف مسجل مسبقاً');
  const currency = isCurrencyCode(input.currency) ? input.currency : BASE_CURRENCY;

  const db = await getDB();
  const id = uuidv4();
  const now = nowIso();
  await db.run(
    `INSERT INTO items
       (id, customer_id, name, price, currency, note, created_at, updated_at, deleted_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)`,
    [id, input.customerId, name, Math.round(input.price), currency, input.note ?? null, now, now],
  );
  await persist();
  return {
    id, customer_id: input.customerId, name, price: Math.round(input.price), currency,
    note: input.note ?? null, created_at: now, updated_at: now, deleted_at: null,
  };
}

export async function updateItem(
  id: string,
  fields: { name?: string; price?: number; currency?: CurrencyCode; note?: string | null },
): Promise<void> {
  const current = await getItem(id);
  if (!current) throw new Error('الصنف غير موجود');

  const name = fields.name?.trim() ?? current.name;
  const price = fields.price !== undefined ? Math.round(fields.price) : current.price;
  const currency = isCurrencyCode(fields.currency) ? fields.currency : current.currency;
  const note = fields.note !== undefined ? fields.note : current.note;
  if (!name) throw new Error('اسم الصنف مطلوب');
  if (!Number.isFinite(price) || price < 0) throw new Error('أدخل سعراً صحيحاً');
  if (await itemNameExists(current.customer_id, name, id)) throw new Error('الصنف مسجل مسبقاً');

  const db = await getDB();
  await db.run(
    `UPDATE items SET name = ?, price = ?, currency = ?, note = ?, updated_at = ?, synced = 0
      WHERE id = ?`,
    [name, price, currency, note, nowIso(), id],
  );
  await persist();
}

// Soft-delete, like a contact: a tombstone so the removal reaches the other
// device instead of the item reappearing on the next pull. Past transactions
// are untouched — they recorded an amount, not a link to this row.
export async function deleteItem(id: string): Promise<void> {
  const db = await getDB();
  const now = nowIso();
  await db.run(
    `UPDATE items SET deleted_at = ?, updated_at = ?, synced = 0 WHERE id = ?`,
    [now, now, id],
  );
  await persist();
}

// ---- Sync helpers (mirroring customers.ts; no persist() — the sync run
// flushes once at the end) ----

export async function getDirtyItems(): Promise<Item[]> {
  const db = await getDB();
  const res = await db.query(`SELECT ${COLS} FROM items WHERE synced = 0`);
  return ((res.values ?? []) as Record<string, unknown>[]).map(toItem);
}

export async function markItemsSynced(rows: { id: string; updated_at: string }[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDB();
  for (const r of rows) {
    await db.run(
      `UPDATE items SET synced = 1 WHERE id = ? AND updated_at = ?`,
      [r.id, r.updated_at],
    );
  }
}

/** Apply an item pulled from the server: insert if new, else last-write-wins by
 *  updated_at. Applied rows match the server, so they land synced = 1. */
export async function applyServerItem(row: {
  id: string; customer_id: string; name: string; price: number; currency: string | null;
  note: string | null; created_at: string; updated_at: string; deleted_at: string | null;
}): Promise<void> {
  const db = await getDB();
  const existing = await getItem(row.id);
  const currency = isCurrencyCode(row.currency) ? row.currency : BASE_CURRENCY;
  if (!existing) {
    await db.run(
      `INSERT INTO items
         (id, customer_id, name, price, currency, note, created_at, updated_at, deleted_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [row.id, row.customer_id, row.name, Math.round(row.price), currency, row.note ?? null,
       row.created_at, row.updated_at, row.deleted_at ?? null],
    );
  } else if (new Date(row.updated_at).getTime() > new Date(existing.updated_at).getTime()) {
    await db.run(
      `UPDATE items SET customer_id = ?, name = ?, price = ?, currency = ?, note = ?,
              updated_at = ?, deleted_at = ?, synced = 1
        WHERE id = ?`,
      [row.customer_id, row.name, Math.round(row.price), currency, row.note ?? null,
       row.updated_at, row.deleted_at ?? null, row.id],
    );
  }
}
