import { getDB, persist } from '../../data/db';
import { uuidv4 } from '../../data/uuid';
import { localDay } from './day';
import { kickPosSync } from './posSyncKick';
import { getMeta, setMeta } from '../../data/meta';
import { findProductByCode, type PosProduct } from './products';

// The day's numbers: what was baked, what was sold, what is left.
//
//   left = baked − sold
//
// Both sides are add-only (see migration 8). «Baked» is entered as it happens —
// 40 at dawn, 20 more at noon — and every scan adds one sale; a mistake is
// fixed with an opposite row, never by editing one.

export { localDay };

export interface DayRow {
  product: PosProduct;
  baked: number;
  sold: number;
  left: number;
  /** Takings, minor units: each sale at the price it was made at. */
  revenue: number;
}

export async function getDayRows(day: string = localDay()): Promise<DayRow[]> {
  const db = await getDB();
  const res = await db.query(
    `SELECT p.id, p.name, p.code, p.price, p.created_at, p.updated_at,
       COALESCE((SELECT SUM(qty) FROM pos_baked b WHERE b.product_id = p.id AND b.day = ?), 0) AS baked,
       COALESCE((SELECT SUM(qty) FROM pos_sales s WHERE s.product_id = p.id AND s.day = ?), 0) AS sold,
       COALESCE((SELECT SUM(qty * price) FROM pos_sales s WHERE s.product_id = p.id AND s.day = ?), 0) AS revenue
     FROM pos_products p
     WHERE p.deleted_at IS NULL
        OR EXISTS (SELECT 1 FROM pos_sales s WHERE s.product_id = p.id AND s.day = ?)
        OR EXISTS (SELECT 1 FROM pos_baked b WHERE b.product_id = p.id AND b.day = ?)
     ORDER BY p.name COLLATE NOCASE`,
    [day, day, day, day, day],
  );
  return ((res.values ?? []) as Record<string, unknown>[]).map((r) => {
    const baked = Number(r.baked) || 0;
    const sold = Number(r.sold) || 0;
    return {
      product: {
        id: String(r.id), name: String(r.name), code: String(r.code),
        price: Number(r.price) || 0,
        created_at: String(r.created_at), updated_at: String(r.updated_at),
      },
      baked, sold, left: baked - sold, revenue: Number(r.revenue) || 0,
    };
  });
}

export function totalsOf(rows: DayRow[]): { baked: number; sold: number; left: number; revenue: number } {
  return rows.reduce(
    (t, r) => ({
      baked: t.baked + r.baked, sold: t.sold + r.sold,
      left: t.left + r.left, revenue: t.revenue + r.revenue,
    }),
    { baked: 0, sold: 0, left: 0, revenue: 0 },
  );
}

// Submitting the day's quantities
//
// The morning's baked numbers are SUBMITTED («اعتماد الكميات») and then locked:
// no stepper, no typing. Selling carries on. A correction is still possible —
// the owner reopens the day (a deliberate, confirmed step that is counted and
// shown in the history) — but inside rules that cannot be broken:
//   • a day that is locked refuses any change to its baked numbers (the data
//     layer enforces it, not only the buttons);
//   • baked can never be taken below what was already sold.

export interface DayLock { locked: boolean; reopened: number }

export async function getDayLock(day: string = localDay()): Promise<DayLock> {
  const db = await getDB();
  const res = await db.query('SELECT locked_at, reopened FROM pos_day_lock WHERE day = ?', [day]);
  const row = (res.values ?? [])[0] as { locked_at: string | null; reopened: number } | undefined;
  return { locked: !!row?.locked_at, reopened: Number(row?.reopened) || 0 };
}

/** Submit: lock the day's baked quantities. Needs something baked. */
export async function lockDay(day: string = localDay()): Promise<void> {
  const total = totalsOf(await getDayRows(day));
  if (total.baked <= 0) throw new Error('لا توجد كميات مخبوزة لاعتمادها.');
  const db = await getDB();
  const now = new Date().toISOString();
  // SELECT-then-write, not an upsert: older Androids ship an SQLite without it.
  const has = ((await db.query('SELECT day FROM pos_day_lock WHERE day = ?', [day])).values ?? []).length > 0;
  if (has) await db.run('UPDATE pos_day_lock SET locked_at = ?, updated_at = ?, synced = 0 WHERE day = ?', [now, now, day]);
  else await db.run('INSERT INTO pos_day_lock (day, locked_at, reopened, updated_at, synced) VALUES (?, ?, 0, ?, 0)', [day, now, now]);
  await persist();
  kickPosSync();
}

/** Reopen a submitted day for a correction. Counted. */
export async function unlockDay(day: string = localDay()): Promise<void> {
  const db = await getDB();
  await db.run(
    'UPDATE pos_day_lock SET locked_at = NULL, reopened = reopened + 1, updated_at = ?, synced = 0 WHERE day = ?',
    [new Date().toISOString(), day],
  );
  await persist();
  kickPosSync();
}

/** Baked more of a product (a negative number takes some back off). Refused on
 *  a submitted day, and refused if it would leave less baked than sold. */
export async function addBaked(productId: string, qty: number, day: string = localDay()): Promise<void> {
  if (!Number.isInteger(qty) || qty === 0) throw new Error('أدخل عدداً صحيحاً');
  if ((await getDayLock(day)).locked) {
    throw new Error('الكميات معتمدة. اضغط «تعديل» لإعادة فتحها أولاً.');
  }
  const db = await getDB();
  const cur = ((await db.query(
    `SELECT COALESCE((SELECT SUM(qty) FROM pos_baked WHERE product_id = ? AND day = ?), 0) AS baked,
            COALESCE((SELECT SUM(qty) FROM pos_sales WHERE product_id = ? AND day = ?), 0) AS sold`,
    [productId, day, productId, day],
  )).values ?? [])[0] as { baked: number; sold: number };
  const baked = Number(cur.baked) || 0;
  const sold = Number(cur.sold) || 0;
  if (baked + qty < sold) {
    throw new Error(`لا يمكن أن تكون الكمية المخبوزة أقل من المباع (${sold}).`);
  }
  await db.run(
    'INSERT INTO pos_baked (id, product_id, day, qty, created_at, synced) VALUES (?, ?, ?, ?, ?, 0)',
    [uuidv4(), productId, day, qty, new Date().toISOString()],
  );
  await persist();
  kickPosSync();
}

/** One sold (qty 1), or one taken back (qty −1). The price is the product's
 *  price right now, kept on the row. */
export async function recordSale(product: PosProduct, qty: 1 | -1 = 1): Promise<void> {
  const db = await getDB();
  await db.run(
    'INSERT INTO pos_sales (id, product_id, day, qty, price, created_at, synced) VALUES (?, ?, ?, ?, ?, ?, 0)',
    [uuidv4(), product.id, localDay(), qty, product.price, new Date().toISOString()],
  );
  await persist();
  kickPosSync();
}

export type ScanOutcome =
  | { ok: true; row: DayRow }
  | { ok: false; reason: 'unknown-code' | 'no-product' };

/** What a scanned string does: find its product and record ONE sale. */
export async function sellByCode(
  raw: string,
  parse: (s: string) => string | null,
): Promise<ScanOutcome> {
  const code = parse(raw);
  if (!code) return { ok: false, reason: 'unknown-code' };
  const product = await findProductByCode(code);
  if (!product) return { ok: false, reason: 'no-product' };
  await recordSale(product, 1);
  const row = (await getDayRows()).find((r) => r.product.id === product.id)!;
  return { ok: true, row };
}

// ---------------------------------------------------------------------------
// History and retention
//
// Every day's rows are kept, never overwritten. After a YEAR the app asks what
// to do with the oldest data — keep saving it, or delete what is older than a
// year — and does nothing until the owner answers: data is never thrown away
// on a timer.

export const KEEP_DAYS = 365;

export interface DaySummary {
  day: string; baked: number; sold: number; revenue: number;
  /** Quantities submitted, and how many times the day was reopened since. */
  locked: boolean; reopened: number;
}

/** Every day that has any activity, newest first. */
export async function listDays(): Promise<DaySummary[]> {
  const db = await getDB();
  const res = await db.query(
    `SELECT t.day, t.baked, t.sold, t.revenue, l.locked_at, l.reopened FROM (
       SELECT day, SUM(baked) AS baked, SUM(sold) AS sold, SUM(revenue) AS revenue FROM (
         SELECT day, 0 AS baked, SUM(qty) AS sold, SUM(qty * price) AS revenue FROM pos_sales GROUP BY day
         UNION ALL
         SELECT day, SUM(qty) AS baked, 0 AS sold, 0 AS revenue FROM pos_baked GROUP BY day
       ) GROUP BY day
     ) t LEFT JOIN pos_day_lock l ON l.day = t.day
     ORDER BY t.day DESC`,
  );
  return ((res.values ?? []) as Record<string, unknown>[]).map((r) => ({
    day: String(r.day), baked: Number(r.baked) || 0,
    sold: Number(r.sold) || 0, revenue: Number(r.revenue) || 0,
    locked: !!r.locked_at, reopened: Number(r.reopened) || 0,
  }));
}

/** The day exactly `KEEP_DAYS` before `from` — anything earlier is «over a year». */
export function cutoffDay(from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() - KEEP_DAYS);
  return localDay(d);
}

async function hasDataBefore(cutoff: string): Promise<boolean> {
  const db = await getDB();
  const res = await db.query(
    `SELECT 1 AS x FROM pos_sales WHERE day < ? UNION ALL SELECT 1 FROM pos_baked WHERE day < ? LIMIT 1`,
    [cutoff, cutoff],
  );
  return (res.values ?? []).length > 0;
}

const KEEP_UNTIL_KEY = 'pos_keep_until';

/** Time to ask? Yes when something is over a year old and the owner has not
 *  already chosen «keep» within the last year. */
export async function retentionDue(now: Date = new Date()): Promise<boolean> {
  if (!(await hasDataBefore(cutoffDay(now)))) return false;
  const keepUntil = await getMeta(KEEP_UNTIL_KEY);
  return !keepUntil || keepUntil <= localDay(now);
}

/** «Keep saving»: ask again in a year. */
export async function keepForAnotherYear(now: Date = new Date()): Promise<void> {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + KEEP_DAYS);
  await setMeta(KEEP_UNTIL_KEY, localDay(d));
}

/** Reverse what a day holds — baked, sold and takings back to zero — for ONE
 *  product, or for every product when `productId` is null.
 *
 *  Both tables are add-only and synced, so this does NOT delete rows (the
 *  server would hand them back on the next pull). It adds an opposite row for
 *  everything entered, exactly like an undo, so the day nets to nothing and the
 *  correction syncs like any other. A sale is reversed at the price it was
 *  made at, which cancels the takings exactly — a price changed mid-day leaves
 *  no phantom riyals. A submitted day is reopened first, and that is counted,
 *  so the record shows the day was amended. Returns the units reversed. */
async function reverseDay(
  day: string,
  productId: string | null,
): Promise<{ baked: number; sold: number }> {
  const db = await getDB();
  const now = new Date().toISOString();
  const only = productId ? ' AND product_id = ?' : '';
  const args = productId ? [day, productId] : [day];
  const sales = ((await db.query(
    `SELECT product_id, price, SUM(qty) AS qty FROM pos_sales WHERE day = ?${only}
      GROUP BY product_id, price HAVING SUM(qty) <> 0`, args,
  )).values ?? []) as { product_id: string; price: number; qty: number }[];
  const baked = ((await db.query(
    `SELECT product_id, SUM(qty) AS qty FROM pos_baked WHERE day = ?${only}
      GROUP BY product_id HAVING SUM(qty) <> 0`, args,
  )).values ?? []) as { product_id: string; qty: number }[];
  if (sales.length === 0 && baked.length === 0) return { baked: 0, sold: 0 };

  // One statement per call — see owner.ts on the Android plugin's batching.
  // Sales first: the baked number can never be taken below the sold one.
  for (const s of sales) {
    await db.run(
      'INSERT INTO pos_sales (id, product_id, day, qty, price, created_at, synced) VALUES (?, ?, ?, ?, ?, ?, 0)',
      [uuidv4(), s.product_id, day, -Number(s.qty), Number(s.price), now],
    );
  }
  for (const b of baked) {
    await db.run(
      'INSERT INTO pos_baked (id, product_id, day, qty, created_at, synced) VALUES (?, ?, ?, ?, ?, 0)',
      [uuidv4(), b.product_id, day, -Number(b.qty), now],
    );
  }
  if ((await getDayLock(day)).locked) {
    await db.run(
      'UPDATE pos_day_lock SET locked_at = NULL, reopened = reopened + 1, updated_at = ?, synced = 0 WHERE day = ?',
      [now, day],
    );
  }
  await persist();
  kickPosSync();
  return {
    baked: baked.reduce((n, b) => n + Number(b.qty), 0),
    sold: sales.reduce((n, s) => n + Number(s.qty), 0),
  };
}

/** «مسح قائمة اليوم»: the whole day's list back to zero. */
export const eraseDay = (day: string = localDay()) => reverseDay(day, null);

/** «حذف من قائمة اليوم»: one product off the day's list. */
export const removeProductFromDay = (productId: string, day: string = localDay()) =>
  reverseDay(day, productId);

/** «Delete»: remove everything older than a year. Returns the rows removed. */
export async function deleteOlderThanYear(now: Date = new Date()): Promise<number> {
  const cutoff = cutoffDay(now);
  const db = await getDB();
  const count = async (t: string) =>
    Number(((await db.query(`SELECT COUNT(*) AS n FROM ${t} WHERE day < ?`, [cutoff])).values ?? [])[0]?.n) || 0;
  const n = (await count('pos_sales')) + (await count('pos_baked'));
  // One statement per call — see owner.ts on the Android plugin's batching.
  await db.run('DELETE FROM pos_sales WHERE day < ?', [cutoff]);
  await db.run('DELETE FROM pos_baked WHERE day < ?', [cutoff]);
  await persist();
  return n;
}
