import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from '../asyncHandler';
import { AuthedRequest } from '../middleware/auth';

// Sync of the point-of-sale section — its OWN endpoint, on purpose. The ledger's
// /sync is the most important code in the app and carries four tables and a
// cursor format other builds depend on; POS is a different domain, so it gets a
// small, separate protocol instead of one more table threaded through that one.
//
// The rules are the ledger's, applied to the POS tables:
//   - pos_products  → upsert by UUID, last-write-wins by updated_at, soft-delete
//                     by tombstone. The CODE is issued once and is never
//                     changed by a later push: it is already on printed labels.
//   - pos_baked / pos_sales → APPEND-ONLY, insert only if the UUID is new.
//   - pos_day_lock  → one row per day, last-write-wins by updated_at.
//   - every row is acknowledged individually (the sender forgets only what the
//     receiver named), a foreign owner's id is refused, and the pull cursor is a
//     keyset on the SERVER's clock, never the phone's.
//
// Mounted behind requireAuth + requireSubscription (cloud sync is the paid
// feature) + requirePos (the section was switched on for this account).

type Row = Record<string, unknown>;
type RejectReason = 'invalid' | 'missing_product' | 'foreign_owner' | 'conflict';
interface TableResult { accepted: string[]; rejected: { id: string; reason: RejectReason }[] }

const router = Router();
const PAGE = 500;
const REWIND_MS = 5000; // see routes/sync.ts: re-pulling a few seconds is free, missing a row is not
const ID_RE = /^[0-9A-Za-z-]{8,36}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_RE = /^2\d{12}$/;
const MAX_QTY = 1_000_000;
const MAX_MONEY = 1_000_000_000_000;

const asArray = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
function toDate(v: unknown): Date | null {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
}
const asDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const isInt = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
const isDupEntry = (err: unknown) => (err as { code?: string })?.code === 'ER_DUP_ENTRY';

const empty = (): TableResult => ({ accepted: [], rejected: [] });

// POST /pos-sync/push — { products, baked, sales, day_locks }
router.post(
  '/push',
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.userId as string;
    const products = asArray(req.body?.products);
    const baked = asArray(req.body?.baked);
    const sales = asArray(req.body?.sales);
    const dayLocks = asArray(req.body?.day_locks);
    const result = { products: empty(), baked: empty(), sales: empty(), day_locks: empty() };

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // ---- products (first, so a sale in the same batch finds its product) ----
      for (const p of products) {
        const id = str(p.id);
        if (!ID_RE.test(id)) continue; // no usable id to acknowledge
        const name = str(p.name).trim();
        const code = str(p.code);
        const price = Number(p.price);
        const updatedAt = toDate(p.updated_at);
        const createdAt = toDate(p.created_at) ?? updatedAt;
        const deletedAt = p.deleted_at ? toDate(p.deleted_at) : null;
        if (!name || name.length > 255 || !CODE_RE.test(code) || !isInt(price, 0, MAX_MONEY) ||
            !updatedAt || !createdAt || (p.deleted_at && !deletedAt)) {
          result.products.rejected.push({ id, reason: 'invalid' });
          continue;
        }
        const [found] = await conn.query('SELECT user_id, updated_at FROM pos_products WHERE id = ?', [id]);
        const existing = (found as Row[])[0];
        if (existing && existing.user_id !== userId) {
          result.products.rejected.push({ id, reason: 'foreign_owner' });
          continue;
        }
        if (existing) {
          // Last write wins. An older or equal copy is acknowledged all the same:
          // the server already holds something at least as new.
          if (updatedAt.getTime() > asDate(existing.updated_at).getTime()) {
            await conn.query(
              `UPDATE pos_products SET name = ?, price = ?, updated_at = ?, deleted_at = ?
                WHERE id = ? AND user_id = ?`,
              [name, price, updatedAt, deletedAt, id, userId]
            );
          }
          result.products.accepted.push(id);
          continue;
        }
        try {
          await conn.query(
            `INSERT INTO pos_products (id, user_id, name, code, price, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, userId, name, code, price, createdAt, updatedAt, deletedAt]
          );
          result.products.accepted.push(id);
        } catch (err) {
          // The same code under another id: two devices issued one number.
          if (!isDupEntry(err)) throw err;
          result.products.rejected.push({ id, reason: 'conflict' });
        }
      }

      // ---- baked + sales: add-only, insert if the UUID is new ----
      const appendOnly = async (
        table: 'pos_baked' | 'pos_sales',
        rows: Row[],
        out: TableResult,
      ) => {
        for (const r of rows) {
          const id = str(r.id);
          if (!ID_RE.test(id)) continue;
          const productId = str(r.product_id);
          const day = str(r.day);
          const qty = Number(r.qty);
          const createdAt = toDate(r.created_at);
          const price = table === 'pos_sales' ? Number(r.price) : 0;
          if (!ID_RE.test(productId) || !DAY_RE.test(day) || !isInt(qty, -MAX_QTY, MAX_QTY) || qty === 0 ||
              !createdAt || (table === 'pos_sales' && !isInt(price, 0, MAX_MONEY))) {
            out.rejected.push({ id, reason: 'invalid' });
            continue;
          }
          const [found] = await conn.query(`SELECT user_id FROM ${table} WHERE id = ?`, [id]);
          const existing = (found as Row[])[0];
          if (existing) {
            if (existing.user_id === userId) out.accepted.push(id); // already stored
            else out.rejected.push({ id, reason: 'foreign_owner' });
            continue;
          }
          // The product must be THIS owner's: a valid id from another tenant is
          // still a leak.
          const [prod] = await conn.query('SELECT 1 FROM pos_products WHERE id = ? AND user_id = ?', [productId, userId]);
          if ((prod as Row[]).length === 0) {
            out.rejected.push({ id, reason: 'missing_product' });
            continue;
          }
          if (table === 'pos_sales') {
            await conn.query(
              `INSERT INTO pos_sales (id, user_id, product_id, day, qty, price, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [id, userId, productId, day, qty, price, createdAt]
            );
          } else {
            await conn.query(
              `INSERT INTO pos_baked (id, user_id, product_id, day, qty, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [id, userId, productId, day, qty, createdAt]
            );
          }
          out.accepted.push(id);
        }
      };
      await appendOnly('pos_baked', baked, result.baked);
      await appendOnly('pos_sales', sales, result.sales);

      // ---- day locks: last-write-wins by updated_at; the id is the day ----
      for (const l of dayLocks) {
        const day = str(l.day);
        if (!DAY_RE.test(day)) continue;
        const updatedAt = toDate(l.updated_at);
        const lockedAt = l.locked_at ? toDate(l.locked_at) : null;
        const reopened = Number(l.reopened ?? 0);
        if (!updatedAt || (l.locked_at && !lockedAt) || !isInt(reopened, 0, MAX_QTY)) {
          result.day_locks.rejected.push({ id: day, reason: 'invalid' });
          continue;
        }
        const [found] = await conn.query('SELECT updated_at FROM pos_day_lock WHERE user_id = ? AND day = ?', [userId, day]);
        const existing = (found as Row[])[0];
        if (!existing) {
          await conn.query(
            'INSERT INTO pos_day_lock (user_id, day, locked_at, reopened, updated_at) VALUES (?, ?, ?, ?, ?)',
            [userId, day, lockedAt, reopened, updatedAt]
          );
        } else if (updatedAt.getTime() > asDate(existing.updated_at).getTime()) {
          await conn.query(
            'UPDATE pos_day_lock SET locked_at = ?, reopened = ?, updated_at = ? WHERE user_id = ? AND day = ?',
            [lockedAt, reopened, updatedAt, userId, day]
          );
        }
        result.day_locks.accepted.push(day);
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return res.json(result);
  })
);

// ---- pull: a keyset cursor per table, on the server's own clock ----
interface TableCursor { ts: Date; id: string }
interface PullCursor { products: TableCursor; baked: TableCursor; sales: TableCursor; locks: TableCursor }
const EPOCH = () => new Date(0);
const fresh = (): TableCursor => ({ ts: EPOCH(), id: '' });

function encodeCursor(c: PullCursor): string {
  return ['p1', ...[c.products, c.baked, c.sales, c.locks].flatMap((t) => [t.ts.toISOString(), t.id])].join('|');
}

function decodeCursor(raw: string | undefined): PullCursor | null {
  if (!raw) return { products: fresh(), baked: fresh(), sales: fresh(), locks: fresh() };
  const parts = raw.split('|');
  if (parts[0] !== 'p1' || parts.length !== 9) return null;
  const cur = (i: number): TableCursor | null => {
    const ts = new Date(parts[i]);
    return Number.isNaN(ts.getTime()) ? null : { ts, id: parts[i + 1] ?? '' };
  };
  const products = cur(1), baked = cur(3), sales = cur(5), locks = cur(7);
  return products && baked && sales && locks ? { products, baked, sales, locks } : null;
}

// GET /pos-sync/pull?since=<cursor>&limit=<n>
router.get(
  '/pull',
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.userId as string;
    const cursor = decodeCursor(typeof req.query.since === 'string' ? req.query.since : undefined);
    if (!cursor) return res.status(400).json({ error: 'since must be a valid cursor' });
    const lim = Number(req.query.limit);
    const limit = Number.isFinite(lim) && lim > 0 ? Math.min(Math.floor(lim), PAGE) : PAGE;

    const [clock] = await pool.query('SELECT NOW(3) AS now');
    const serverNow = asDate((clock as Row[])[0].now);

    const fetchPage = async (table: string, cols: string, idCol: string, cur: TableCursor) => {
      const [rows] = await pool.query(
        `SELECT ${cols}, server_updated_at FROM ${table}
          WHERE user_id = ? AND (server_updated_at > ? OR (server_updated_at = ? AND ${idCol} > ?))
          ORDER BY server_updated_at ASC, ${idCol} ASC LIMIT ?`,
        [userId, cur.ts, cur.ts, cur.id, limit + 1]
      );
      const all = rows as Row[];
      return { rows: all.length > limit ? all.slice(0, limit) : all, more: all.length > limit };
    };

    const p = await fetchPage('pos_products', 'id, name, code, price, created_at, updated_at, deleted_at', 'id', cursor.products);
    const b = await fetchPage('pos_baked', 'id, product_id, day, qty, created_at', 'id', cursor.baked);
    const s = await fetchPage('pos_sales', 'id, product_id, day, qty, price, created_at', 'id', cursor.sales);
    const l = await fetchPage('pos_day_lock', 'day, locked_at, reopened, updated_at', 'day', cursor.locks);
    const hasMore = p.more || b.more || s.more || l.more;

    const advance = (rows: Row[], idCol: string, prev: TableCursor): TableCursor => {
      const last = rows[rows.length - 1];
      return last ? { ts: asDate(last.server_updated_at), id: String(last[idCol]) } : prev;
    };
    let next: PullCursor = {
      products: advance(p.rows, 'id', cursor.products),
      baked: advance(b.rows, 'id', cursor.baked),
      sales: advance(s.rows, 'id', cursor.sales),
      locks: advance(l.rows, 'day', cursor.locks),
    };
    // Once drained, rewind to a moment safely in the past (see REWIND_MS).
    if (!hasMore) {
      const safe = { ts: new Date(serverNow.getTime() - REWIND_MS), id: '' };
      next = { products: safe, baked: { ...safe }, sales: { ...safe }, locks: { ...safe } };
    }

    return res.json({
      products: p.rows, baked: b.rows, sales: s.rows, day_locks: l.rows,
      synced_at: encodeCursor(next), has_more: hasMore,
    });
  })
);

export default router;
