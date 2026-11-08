import { getDB, persist } from '../../data/db';
import { getMeta, setMeta } from '../../data/meta';
import {
  ApiError, posSyncPull, posSyncPush,
  type PosPullResult, type PosPushBody, type PosPushResult,
} from '../../lib/api';

// Sync of the point-of-sale section: push what is dirty, pull what is new.
//
// Same shape as the ledger's sync (src/data/sync.ts) and the same promises:
//   - a row is marked clean ONLY if the server named it in `accepted`;
//   - products and day locks are last-write-wins by updated_at, baked and sales
//     are add-only (insert if the id is new), so applying a pull twice changes
//     nothing;
//   - the pull cursor is the server's, kept in app_meta.
// It never throws: the outcome says what happened.
//
// A product's CODE is never overwritten by a pull — it is printed on labels.

export type PosSyncOutcome =
  | { status: 'ok'; pushed: number; pulled: number; refused: number }
  | { status: 'skipped' }   // 402 (sync not active) / 403 (section not enabled): nothing to do
  | { status: 'offline' }
  | { status: 'error'; message: string };

export interface PosSyncApi {
  push(body: PosPushBody): Promise<PosPushResult>;
  pull(since: string | null): Promise<PosPullResult>;
}
const realApi: PosSyncApi = { push: posSyncPush, pull: posSyncPull };

const CURSOR_KEY = 'pos_sync_since';
const CHUNK = 200;
const ms = (iso: string | null | undefined): number => (iso ? new Date(iso).getTime() : 0);

type Row = Record<string, unknown>;
const rowsOf = async (sql: string, params: unknown[] = []): Promise<Row[]> =>
  (((await (await getDB()).query(sql, params)).values ?? []) as Row[]);

let inFlight: Promise<PosSyncOutcome> | null = null;

/** Run one sync. Concurrent calls share the run in progress. */
export function runPosSync(api: PosSyncApi = realApi): Promise<PosSyncOutcome> {
  if (!inFlight) {
    inFlight = doSync(api).finally(() => { inFlight = null; });
  }
  return inFlight;
}

async function doSync(api: PosSyncApi): Promise<PosSyncOutcome> {
  try {
    const { pushed, refused } = await pushDirty(api);
    const pulled = await pullAll(api);
    return { status: 'ok', pushed, pulled, refused };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 402 || err.status === 403) return { status: 'skipped' };
      if (err.status === 0) return { status: 'offline' };
    }
    return { status: 'error', message: err instanceof Error ? err.message : 'sync failed' };
  }
}

// ---------------------------------------------------------------- push

async function pushDirty(api: PosSyncApi): Promise<{ pushed: number; refused: number }> {
  const db = await getDB();
  let pushed = 0;
  let refused = 0;
  // Keep going while a round still clears something: a sale refused as
  // `missing_product` may go through once its product has been acknowledged.
  for (let round = 0; round < 50; round++) {
    const products = await rowsOf(
      `SELECT id, name, code, price, created_at, updated_at, deleted_at
         FROM pos_products WHERE synced = 0 LIMIT ?`, [CHUNK]);
    const baked = await rowsOf(
      'SELECT id, product_id, day, qty, created_at FROM pos_baked WHERE synced = 0 LIMIT ?', [CHUNK]);
    const sales = await rowsOf(
      'SELECT id, product_id, day, qty, price, created_at FROM pos_sales WHERE synced = 0 LIMIT ?', [CHUNK]);
    const locks = await rowsOf(
      'SELECT day, locked_at, reopened, updated_at FROM pos_day_lock WHERE synced = 0 LIMIT ?', [CHUNK]);
    if (products.length + baked.length + sales.length + locks.length === 0) break;

    const res = await api.push({
      products: products as never, baked: baked as never,
      sales: sales as never, day_locks: locks as never,
    });

    let cleared = 0;
    const clear = async (table: string, idCol: string, ids: string[]) => {
      for (const id of ids) {
        await db.run(`UPDATE ${table} SET synced = 1 WHERE ${idCol} = ?`, [id]);
        cleared += 1;
      }
    };
    await clear('pos_products', 'id', res.products.accepted);
    await clear('pos_baked', 'id', res.baked.accepted);
    await clear('pos_sales', 'id', res.sales.accepted);
    await clear('pos_day_lock', 'day', res.day_locks.accepted);
    pushed += cleared;
    // What is STILL refused after this round (not a running total: a row that
    // stays refused would otherwise be counted once per round).
    refused = res.products.rejected.length + res.baked.rejected.length +
      res.sales.rejected.length + res.day_locks.rejected.length;
    await persist();
    if (cleared === 0) break; // nothing moved: what is left was refused — stop, don't spin
  }
  return { pushed, refused };
}

// ---------------------------------------------------------------- pull

async function pullAll(api: PosSyncApi): Promise<number> {
  let since = await getMeta(CURSOR_KEY);
  let total = 0;
  for (let page = 0; page < 200; page++) {
    const res = await api.pull(since);
    total += await applyPull(res);
    since = res.synced_at;
    await setMeta(CURSOR_KEY, since);
    if (!res.has_more) break;
  }
  return total;
}

/** Apply one pull page. Idempotent: running it twice changes nothing. */
export async function applyPull(res: PosPullResult): Promise<number> {
  const db = await getDB();
  let applied = 0;

  for (const p of res.products) {
    const local = (await rowsOf('SELECT updated_at FROM pos_products WHERE id = ?', [p.id]))[0];
    if (!local) {
      // The same code under another id here: refuse rather than break the
      // unique index. (Two devices issued one number — the server flags it too.)
      const clash = await rowsOf('SELECT id FROM pos_products WHERE code = ? AND id <> ?', [p.code, p.id]);
      if (clash.length > 0) continue;
      await db.run(
        `INSERT INTO pos_products (id, name, code, price, created_at, updated_at, deleted_at, synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [p.id, p.name, p.code, p.price, p.created_at, p.updated_at, p.deleted_at],
      );
      applied += 1;
    } else if (ms(p.updated_at) > ms(String(local.updated_at))) {
      // Last write wins; the code stays as it is.
      await db.run(
        'UPDATE pos_products SET name = ?, price = ?, updated_at = ?, deleted_at = ?, synced = 1 WHERE id = ?',
        [p.name, p.price, p.updated_at, p.deleted_at, p.id],
      );
      applied += 1;
    }
  }

  for (const b of res.baked) {
    if ((await rowsOf('SELECT id FROM pos_baked WHERE id = ?', [b.id])).length > 0) continue;
    await db.run(
      'INSERT INTO pos_baked (id, product_id, day, qty, created_at, synced) VALUES (?, ?, ?, ?, ?, 1)',
      [b.id, b.product_id, b.day, b.qty, b.created_at],
    );
    applied += 1;
  }
  for (const s of res.sales) {
    if ((await rowsOf('SELECT id FROM pos_sales WHERE id = ?', [s.id])).length > 0) continue;
    await db.run(
      'INSERT INTO pos_sales (id, product_id, day, qty, price, created_at, synced) VALUES (?, ?, ?, ?, ?, ?, 1)',
      [s.id, s.product_id, s.day, s.qty, s.price, s.created_at],
    );
    applied += 1;
  }

  for (const l of res.day_locks) {
    const local = (await rowsOf('SELECT updated_at FROM pos_day_lock WHERE day = ?', [l.day]))[0];
    if (!local) {
      await db.run(
        'INSERT INTO pos_day_lock (day, locked_at, reopened, updated_at, synced) VALUES (?, ?, ?, ?, 1)',
        [l.day, l.locked_at, l.reopened, l.updated_at],
      );
      applied += 1;
    } else if (ms(l.updated_at) > ms(String(local.updated_at))) {
      await db.run(
        'UPDATE pos_day_lock SET locked_at = ?, reopened = ?, updated_at = ?, synced = 1 WHERE day = ?',
        [l.locked_at, l.reopened, l.updated_at, l.day],
      );
      applied += 1;
    }
  }
  await persist();
  return applied;
}
