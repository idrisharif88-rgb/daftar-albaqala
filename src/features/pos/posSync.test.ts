import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import initSqlJs from 'sql.js';

// Real SQLite (sql.js) behind the data layer, and a FAKE server behind the
// network: the sync's decisions are tested, not the wire.
let sql: import('sql.js').Database;
const adapter = {
  async query(q: string, p: unknown[] = []) {
    const st = sql.prepare(q);
    st.bind(p as never[]);
    const values: Record<string, unknown>[] = [];
    while (st.step()) values.push(st.getAsObject());
    st.free();
    return { values };
  },
  async run(q: string, p: unknown[] = []) { sql.run(q, p as never[]); },
  async execute(q: string) { sql.exec(q); },
};
vi.mock('../../data/db', () => ({ getDB: async () => adapter, persist: async () => {} }));

import { SCHEMA } from '../../data/schema';
import { runMigrations } from '../../data/migrations';
import { createProduct, listProducts } from './products';
import { addBaked, recordSale, lockDay, getDayRows } from './stock';
import { applyPull, countUnsyncedPos, runPosSync, type PosSyncApi } from './posSync';
import { ApiError, type PosPullResult, type PosPushBody, type PosPushResult } from '../../lib/api';
import { getMeta } from '../../data/meta';

const ack = (ids: string[] = [], rejected: { id: string; reason: string }[] = []) => ({ accepted: ids, rejected });
const emptyPull = (over: Partial<PosPullResult> = {}): PosPullResult => ({
  products: [], baked: [], sales: [], day_locks: [], synced_at: 'p1|x', has_more: false, ...over,
});
const dirty = async (table: string) =>
  (await adapter.query(`SELECT COUNT(*) AS n FROM ${table} WHERE synced = 0`)).values[0].n as number;

beforeAll(async () => {
  const SQL = await initSqlJs();
  sql = new SQL.Database();
  await adapter.execute(SCHEMA);
  await runMigrations(adapter as never);
});
beforeEach(() => {
  for (const t of ['pos_sales', 'pos_baked', 'pos_day_lock', 'pos_products', 'app_meta']) sql.run(`DELETE FROM ${t}`);
});

/** A fake server that accepts everything it is sent. */
function acceptingApi(pulls: PosPullResult[] = [emptyPull()]): PosSyncApi & { pushes: PosPushBody[] } {
  const pushes: PosPushBody[] = [];
  let i = 0;
  return {
    pushes,
    async push(body) {
      pushes.push(body);
      return {
        products: ack((body.products ?? []).map((r) => r.id)),
        baked: ack((body.baked ?? []).map((r) => r.id)),
        sales: ack((body.sales ?? []).map((r) => r.id)),
        day_locks: ack((body.day_locks ?? []).map((r) => r.day)),
      } as PosPushResult;
    },
    async pull() { return pulls[Math.min(i++, pulls.length - 1)]; },
  };
}

describe('POS sync — push', () => {
  it('sends everything dirty and marks it clean once acknowledged', async () => {
    const p = await createProduct({ name: 'خبز', price: 5000 });
    await addBaked(p.id, 10);
    await recordSale(p);
    await lockDay();
    expect(await dirty('pos_products')).toBe(1);

    const api = acceptingApi();
    const out = await runPosSync(api);
    expect(out).toMatchObject({ status: 'ok', pushed: 4, refused: 0 });
    for (const t of ['pos_products', 'pos_baked', 'pos_sales', 'pos_day_lock']) expect(await dirty(t)).toBe(0);
    expect(api.pushes[0].sales?.[0]).toMatchObject({ product_id: p.id, qty: 1, price: 5000 });
  });

  it('counts what is still waiting — what guards a staff sign-out', async () => {
    const before = await countUnsyncedPos();
    const p = await createProduct({ name: 'عدّاد', price: 100 });
    await addBaked(p.id, 3);
    await recordSale(p);
    expect(await countUnsyncedPos()).toBe(before + 3);
    await runPosSync(acceptingApi());
    expect(await countUnsyncedPos()).toBe(0);
  });

  it('keeps a REFUSED row dirty — only what the server named is forgotten', async () => {
    const good = await createProduct({ name: 'جيد', price: 100 });
    const bad = await createProduct({ name: 'مرفوض', price: 100 });
    const api: PosSyncApi = {
      // Like the real server: it only speaks about the rows it was SENT.
      async push(body) {
        const sent = (body.products ?? []).map((r) => r.id);
        return {
          products: ack(sent.filter((id) => id === good.id),
            sent.filter((id) => id === bad.id).map((id) => ({ id, reason: 'conflict' }))),
          baked: ack(), sales: ack(), day_locks: ack(),
        } as PosPushResult;
      },
      async pull() { return emptyPull(); },
    };
    const out = await runPosSync(api);
    expect(out).toMatchObject({ status: 'ok', pushed: 1, refused: 1 });
    const left = (await adapter.query('SELECT id FROM pos_products WHERE synced = 0')).values;
    expect(left).toEqual([{ id: bad.id }]);
  });

  it('a refusal that clears nothing does not spin forever', async () => {
    const p = await createProduct({ name: 'عالق', price: 1 });
    let calls = 0;
    const api: PosSyncApi = {
      async push() { calls += 1; return { products: ack([], [{ id: p.id, reason: 'conflict' }]), baked: ack(), sales: ack(), day_locks: ack() } as PosPushResult; },
      async pull() { return emptyPull(); },
    };
    await runPosSync(api);
    expect(calls).toBe(1);
  });
});

describe('POS sync — pull', () => {
  const prod = (over: Record<string, unknown> = {}) => ({
    id: 'p-0000001', name: 'من الخادم', code: '2000000000008', price: 900,
    created_at: '2026-11-08T05:00:00.000Z', updated_at: '2026-11-08T05:00:00.000Z', deleted_at: null, ...over,
  });

  it('brings in products, baked and sales from another device — clean, not re-pushed', async () => {
    await applyPull(emptyPull({
      products: [prod()],
      baked: [{ id: 'b-0000001', product_id: 'p-0000001', day: '2026-11-08', qty: 20, created_at: '2026-11-08T05:00:00.000Z' }],
      sales: [{ id: 's-0000001', product_id: 'p-0000001', day: '2026-11-08', qty: 1, price: 900, created_at: '2026-11-08T06:00:00.000Z' }],
    }));
    const row = (await getDayRows('2026-11-08')).find((r) => r.product.id === 'p-0000001')!;
    expect([row.baked, row.sold, row.revenue]).toEqual([20, 1, 900]);
    for (const t of ['pos_products', 'pos_baked', 'pos_sales']) expect(await dirty(t)).toBe(0);
  });

  it('is idempotent: the same page twice changes nothing', async () => {
    const page = emptyPull({ products: [prod()] });
    expect(await applyPull(page)).toBe(1);
    expect(await applyPull(page)).toBe(0);
    expect((await listProducts()).length).toBe(1);
  });

  it('last write wins, and a pull NEVER changes a product\'s code', async () => {
    await applyPull(emptyPull({ products: [prod()] }));
    await applyPull(emptyPull({ products: [prod({ name: 'أحدث', price: 1200, code: '2999999999994', updated_at: '2026-11-09T05:00:00.000Z' })] }));
    await applyPull(emptyPull({ products: [prod({ name: 'أقدم', updated_at: '2026-11-01T05:00:00.000Z' })] }));
    const [p] = await listProducts();
    expect([p.name, p.price, p.code]).toEqual(['أحدث', 1200, '2000000000008']);
  });

  it('a tombstone removes the product from the list', async () => {
    await applyPull(emptyPull({ products: [prod()] }));
    await applyPull(emptyPull({ products: [prod({ deleted_at: '2026-11-09T05:00:00.000Z', updated_at: '2026-11-09T05:00:00.000Z' })] }));
    expect(await listProducts()).toEqual([]);
  });

  it('refuses a product whose code clashes with another id here', async () => {
    await applyPull(emptyPull({ products: [prod()] }));
    await applyPull(emptyPull({ products: [prod({ id: 'p-0000002', name: 'نسخة' })] }));
    expect((await listProducts()).length).toBe(1);
  });

  it('day lock: last write wins', async () => {
    const lock = { day: '2026-11-08', locked_at: '2026-11-08T06:00:00.000Z', reopened: 0, updated_at: '2026-11-08T06:00:00.000Z' };
    await applyPull(emptyPull({ day_locks: [lock] }));
    await applyPull(emptyPull({ day_locks: [{ ...lock, locked_at: null, reopened: 2, updated_at: '2026-11-08T08:00:00.000Z' }] }));
    await applyPull(emptyPull({ day_locks: [{ ...lock, reopened: 9, updated_at: '2026-11-08T01:00:00.000Z' }] }));
    const r = (await adapter.query('SELECT locked_at, reopened FROM pos_day_lock')).values[0];
    expect(r).toEqual({ locked_at: null, reopened: 2 });
  });

  it('follows has_more and keeps the server\'s cursor', async () => {
    const api = acceptingApi([
      emptyPull({ products: [prod()], synced_at: 'p1|page1', has_more: true }),
      emptyPull({ products: [prod({ id: 'p-0000003', code: '2111111111116', name: 'ثان' })], synced_at: 'p1|done', has_more: false }),
    ]);
    const out = await runPosSync(api);
    expect(out).toMatchObject({ status: 'ok', pulled: 2 });
    expect(await getMeta('pos_sync_since')).toBe('p1|done');
  });
});

describe('POS sync — outcomes', () => {
  const failing = (status: number): PosSyncApi => ({
    async push() { throw new ApiError(status, 'x', null); },
    async pull() { throw new ApiError(status, 'x', null); },
  });

  it('402 and 403 are "nothing to do", not errors', async () => {
    await createProduct({ name: 'محلي', price: 1 });
    expect((await runPosSync(failing(402))).status).toBe('skipped');
    expect((await runPosSync(failing(403))).status).toBe('skipped');
    expect(await dirty('pos_products')).toBe(1); // still safe on the phone
  });
  it('a dead network is "offline"', async () => {
    expect((await runPosSync(failing(0))).status).toBe('offline');
  });
});
