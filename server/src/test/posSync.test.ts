import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor } from './helpers';

// Sync of the point-of-sale section (/pos-sync). Same rules as the ledger:
// per-row acknowledgement, last-write-wins for products and day locks,
// add-only baked/sales, tenant isolation, a keyset pull on the server's clock —
// plus the section's own: the CODE of a product never changes after it is first
// stored, and the account must have been given the section.

const AUTH = (t: string) => ({ Authorization: `Bearer ${t}` });
const EAN = (n: number) => `2${String(n).padStart(11, '0')}0`; // shape only; the server checks the shape

function aProduct(over: Record<string, unknown> = {}) {
  return {
    id: randomUUID(), name: 'خبز تنور', code: EAN(1), price: 5000,
    created_at: '2026-11-08T05:00:00Z', updated_at: '2026-11-08T05:00:00Z', deleted_at: null,
    ...over,
  };
}
const aSale = (productId: string, over: Record<string, unknown> = {}) => ({
  id: randomUUID(), product_id: productId, day: '2026-11-08', qty: 1, price: 5000,
  created_at: '2026-11-08T06:00:00Z', ...over,
});
const aBake = (productId: string, over: Record<string, unknown> = {}) => ({
  id: randomUUID(), product_id: productId, day: '2026-11-08', qty: 40,
  created_at: '2026-11-08T05:30:00Z', ...over,
});

describe('POS sync', () => {
  let userA: string; let userB: string; let tokenA: string; let tokenB: string;

  before(() => {
    assert.equal(process.env.DB_NAME, 'daftar_test',
      'refusing to run: DB_NAME must be daftar_test, got ' + process.env.DB_NAME);
  });
  beforeEach(async () => {
    await cleanDb();
    userA = await seedUser(); userB = await seedUser();
    await pool.query('UPDATE users SET pos_enabled = 1 WHERE id IN (?, ?)', [userA, userB]);
    tokenA = tokenFor(userA); tokenB = tokenFor(userB);
  });
  after(async () => { await pool.end(); });

  const push = (token: string, body: Record<string, unknown>) =>
    request(app).post('/pos-sync/push').set(AUTH(token)).send(body);

  test('refuses without a token, without the section, and without active sync', async () => {
    assert.equal((await request(app).post('/pos-sync/push').send({})).status, 401);
    await pool.query('UPDATE users SET pos_enabled = 0 WHERE id = ?', [userA]);
    assert.equal((await push(tokenA, {})).status, 403);
    const idle = await seedUser({ status: 'none' });
    await pool.query('UPDATE users SET pos_enabled = 1 WHERE id = ?', [idle]);
    assert.equal((await push(tokenFor(idle), {})).status, 402);
  });

  test('stores products, baked and sales and acknowledges each by id', async () => {
    const p = aProduct(); const b = aBake(p.id); const s = aSale(p.id);
    const res = await push(tokenA, { products: [p], baked: [b], sales: [s] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.products.accepted, [p.id]);
    assert.deepEqual(res.body.baked.accepted, [b.id]);
    assert.deepEqual(res.body.sales.accepted, [s.id]);
    const [rows] = await pool.query('SELECT qty, price FROM pos_sales WHERE id = ?', [s.id]);
    assert.equal(Number((rows as { price: number }[])[0].price), 5000);
  });

  test('add-only rows are idempotent: pushing twice stores one', async () => {
    const p = aProduct(); const s = aSale(p.id);
    await push(tokenA, { products: [p], sales: [s] });
    const again = await push(tokenA, { products: [p], sales: [s] });
    assert.deepEqual(again.body.sales.accepted, [s.id]);
    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM pos_sales WHERE user_id = ?', [userA]);
    assert.equal(Number((rows as { n: number }[])[0].n), 1);
  });

  test('products: last write wins, and the CODE is never changed', async () => {
    const p = aProduct();
    await push(tokenA, { products: [p] });
    // newer: name + price change, and a different code is ignored
    await push(tokenA, { products: [{ ...p, name: 'خبز جديد', price: 7000, code: EAN(2), updated_at: '2026-11-09T05:00:00Z' }] });
    // older: ignored
    const old = await push(tokenA, { products: [{ ...p, name: 'قديم', updated_at: '2026-11-01T05:00:00Z' }] });
    assert.deepEqual(old.body.products.accepted, [p.id]); // acknowledged, not applied
    const [rows] = await pool.query('SELECT name, price, code FROM pos_products WHERE id = ?', [p.id]);
    const r = (rows as { name: string; price: number; code: string }[])[0];
    assert.equal(r.name, 'خبز جديد');
    assert.equal(Number(r.price), 7000);
    assert.equal(r.code, EAN(1));
  });

  test('two products with one code: the second is a conflict, not a crash', async () => {
    await push(tokenA, { products: [aProduct()] });
    const res = await push(tokenA, { products: [aProduct({ name: 'آخر' })] });
    assert.equal(res.body.products.rejected[0].reason, 'conflict');
  });

  test('tenant isolation: a foreign id or a foreign product is refused', async () => {
    const pA = aProduct();
    await push(tokenA, { products: [pA] });
    // B reuses A's product id
    const steal = await push(tokenB, { products: [{ ...pA, name: 'سرقة' }] });
    assert.equal(steal.body.products.rejected[0].reason, 'foreign_owner');
    // B sells A's product
    const sale = await push(tokenB, { sales: [aSale(pA.id)] });
    assert.equal(sale.body.sales.rejected[0].reason, 'missing_product');
    // A's product is untouched
    const [rows] = await pool.query('SELECT name FROM pos_products WHERE id = ?', [pA.id]);
    assert.equal((rows as { name: string }[])[0].name, 'خبز تنور');
  });

  test('a sale before its product is retryable (missing_product), then lands', async () => {
    const p = aProduct(); const s = aSale(p.id);
    const first = await push(tokenA, { sales: [s] });
    assert.equal(first.body.sales.rejected[0].reason, 'missing_product');
    const second = await push(tokenA, { products: [p], sales: [s] });
    assert.deepEqual(second.body.sales.accepted, [s.id]);
  });

  test('malformed rows are rejected per row, the rest still land', async () => {
    const p = aProduct();
    const res = await push(tokenA, {
      products: [p, aProduct({ code: 'ABC', name: 'سيئ' }), aProduct({ price: -5, code: EAN(3) })],
      baked: [aBake(p.id), aBake(p.id, { qty: 0 }), aBake(p.id, { day: 'yesterday' })],
    });
    assert.deepEqual(res.body.products.accepted, [p.id]);
    assert.equal(res.body.products.rejected.length, 2);
    assert.equal(res.body.baked.accepted.length, 1);
    assert.equal(res.body.baked.rejected.length, 2);
  });

  test('day lock: last write wins, per day', async () => {
    const lock = { day: '2026-11-08', locked_at: '2026-11-08T06:00:00Z', reopened: 0, updated_at: '2026-11-08T06:00:00Z' };
    await push(tokenA, { day_locks: [lock] });
    await push(tokenA, { day_locks: [{ ...lock, locked_at: null, reopened: 1, updated_at: '2026-11-08T07:00:00Z' }] });
    await push(tokenA, { day_locks: [{ ...lock, reopened: 9, updated_at: '2026-11-08T05:00:00Z' }] }); // older
    const [rows] = await pool.query('SELECT locked_at, reopened FROM pos_day_lock WHERE user_id = ?', [userA]);
    const r = (rows as { locked_at: Date | null; reopened: number }[])[0];
    assert.equal(r.locked_at, null);
    assert.equal(r.reopened, 1);
  });

  test('pull returns only this owner’s rows, tombstones included', async () => {
    const p = aProduct(); const gone = aProduct({ code: EAN(2), name: 'محذوف', deleted_at: '2026-11-08T08:00:00Z', updated_at: '2026-11-08T08:00:00Z' });
    await push(tokenA, { products: [p, gone], baked: [aBake(p.id)], sales: [aSale(p.id)] });
    await push(tokenB, { products: [aProduct({ code: EAN(9), name: 'ليس لك' })] });

    const res = await request(app).get('/pos-sync/pull').set(AUTH(tokenA));
    assert.equal(res.status, 200);
    assert.equal(res.body.products.length, 2);
    assert.ok(res.body.products.some((x: { id: string; deleted_at: string | null }) => x.id === gone.id && x.deleted_at));
    assert.equal(res.body.baked.length, 1);
    assert.equal(res.body.sales.length, 1);
    assert.ok(!JSON.stringify(res.body).includes('ليس لك'));
  });

  test('pull pages with a keyset, even when rows share a timestamp', async () => {
    const p = aProduct();
    const sales = Array.from({ length: 5 }, () => aSale(p.id));
    await push(tokenA, { products: [p], sales });
    // force every sale onto ONE server timestamp: a timestamp-only cursor would stall
    await pool.query("UPDATE pos_sales SET server_updated_at = '2026-11-08 06:00:00.000' WHERE user_id = ?", [userA]);

    const seen = new Set<string>();
    let since: string | undefined; let guard = 0;
    for (;;) {
      const res = await request(app).get('/pos-sync/pull').set(AUTH(tokenA))
        .query({ limit: 2, ...(since ? { since } : {}) });
      for (const s of res.body.sales) seen.add(s.id);
      since = res.body.synced_at;
      if (!res.body.has_more || ++guard > 10) break;
    }
    assert.equal(seen.size, 5);
  });

  test('a bad cursor is a 400', async () => {
    const res = await request(app).get('/pos-sync/pull').set(AUTH(tokenA)).query({ since: 'nonsense' });
    assert.equal(res.status, 400);
  });
});
