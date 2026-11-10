import { beforeAll, describe, expect, it, vi } from 'vitest';
import initSqlJs from 'sql.js';

// A real SQLite (sql.js) behind the same three calls the app makes, so the
// day's arithmetic is tested against the actual SQL, not a stand-in.
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
import { createProduct } from './products';
import {
  addBaked, getDayRows, localDay, recordSale, sellByCode, totalsOf, listDays, cutoffDay,
  retentionDue, keepForAnotherYear, deleteOlderThanYear, getDayLock, lockDay, unlockDay, eraseDay,
  removeProductFromDay,
} from './stock';
import { deleteProduct, exportProductsJson, importProductsJson, listProducts, updateProduct } from './products';
import { parseScannedCode } from '../../lib/productCodes';

beforeAll(async () => {
  const SQL = await initSqlJs();
  sql = new SQL.Database();
  await adapter.execute(SCHEMA);
  await runMigrations(adapter as never);
});

describe('the bakery day', () => {
  it('baked − sold = left, per product and in total', async () => {
    const bread = await createProduct({ name: 'خبز تنور', price: 5000 });
    const cake = await createProduct({ name: 'كيك المكسرات', price: 20000 });
    await addBaked(bread.id, 40);
    await addBaked(bread.id, 20); // a second batch at noon
    await addBaked(cake.id, 10);
    for (let i = 0; i < 25; i++) await recordSale(bread);
    await recordSale(cake);

    const rows = await getDayRows();
    const b = rows.find((r) => r.product.id === bread.id)!;
    expect([b.baked, b.sold, b.left, b.revenue]).toEqual([60, 25, 35, 125000]);
    const t = totalsOf(rows);
    expect([t.baked, t.sold, t.left, t.revenue]).toEqual([70, 26, 44, 145000]);
  });

  it('a scan sells ONE; an unknown or foreign code sells nothing', async () => {
    const p = await createProduct({ name: 'سمبوسة', price: 1000 });
    const ok = await sellByCode(p.code, parseScannedCode);
    expect(ok.ok && ok.row.sold).toBe(1);
    expect((await sellByCode('6285602015254', parseScannedCode))).toEqual({ ok: false, reason: 'unknown-code' });
    const ghost = '2000000000008';
    expect(parseScannedCode(ghost)).toBe(ghost);
    expect((await sellByCode(ghost, parseScannedCode))).toEqual({ ok: false, reason: 'no-product' });
  });

  it('undo is an opposite row, and an old price does not rewrite old takings', async () => {
    const p = await createProduct({ name: 'كدم', price: 3000 });
    await recordSale(p);
    await recordSale(p, -1);
    expect((await getDayRows()).find((r) => r.product.id === p.id)!.sold).toBe(0);

    await recordSale(p); // sold at 3000
    sql.run('UPDATE pos_products SET price = 9000 WHERE id = ?', [p.id]);
    const row = (await getDayRows()).find((r) => r.product.id === p.id)!;
    expect(row.revenue).toBe(3000);
  });

  it('keeps days apart', async () => {
    const p = await createProduct({ name: 'ذمول', price: 100 });
    await addBaked(p.id, 5, '2020-01-01');
    const today = (await getDayRows(localDay())).find((r) => r.product.id === p.id)!;
    const then = (await getDayRows('2020-01-01')).find((r) => r.product.id === p.id)!;
    expect([today.baked, then.baked]).toEqual([0, 5]);
  });

  it('a deleted product keeps its past rows visible', async () => {
    const p = await createProduct({ name: 'مؤقت', price: 100 });
    await addBaked(p.id, 7, '2020-02-02');
    await deleteProduct(p.id);
    const then = (await getDayRows('2020-02-02')).find((r) => r.product.id === p.id);
    expect(then?.baked).toBe(7);
    expect((await getDayRows()).some((r) => r.product.id === p.id)).toBe(false);
  });

  it('lists every day with its totals, newest first', async () => {
    const days = await listDays();
    expect(days[0].day).toBe(localDay());
    const d = days.find((x) => x.day === '2020-01-01')!;
    expect(d.baked).toBe(5);
  });
});

describe('one-year retention', () => {
  it('asks only when data is over a year old, and only once it is answered', async () => {
    const now = new Date(2026, 10, 8); // 8 Nov 2026
    expect(cutoffDay(now)).toBe('2025-11-08');
    // 2020 rows from the tests above are way older than a year.
    expect(await retentionDue(now)).toBe(true);
    await keepForAnotherYear(now);
    expect(await retentionDue(now)).toBe(false);
    expect(await retentionDue(new Date(2027, 10, 9))).toBe(true); // a year later
  });

  it('delete removes only what is older than a year', async () => {
    const now = new Date(2026, 10, 8);
    const p = await createProduct({ name: 'حديث', price: 100 });
    await addBaked(p.id, 3); // today
    expect(await deleteOlderThanYear(now)).toBeGreaterThan(0);
    expect((await listDays()).some((d) => d.day < cutoffDay(now))).toBe(false);
    expect((await getDayRows()).find((r) => r.product.id === p.id)!.baked).toBe(3);
    expect(await retentionDue(now)).toBe(false);
  });
});

describe('moving the product list to another device', () => {
  it('keeps every code, and importing twice changes nothing', async () => {
    const before = await listProducts();
    const text = await exportProductsJson();
    sql.run('DELETE FROM pos_products');
    const first = await importProductsJson(text);
    expect(first.added).toBe(before.length);
    const after = await listProducts();
    expect(after.map((p) => [p.name, p.code, p.price]).sort())
      .toEqual(before.map((p) => [p.name, p.code, p.price]).sort());
    expect(await importProductsJson(text)).toEqual({ added: 0, skipped: before.length, baked: 0 });
  });

  it("carries today's baked quantities, once", async () => {
    const [p] = await listProducts();
    const bakedBefore = (await getDayRows()).find((r) => r.product.id === p.id)!.baked;
    const text = await exportProductsJson();
    sql.run('DELETE FROM pos_products');
    sql.run('DELETE FROM pos_baked');
    const r = await importProductsJson(text);
    expect(r.baked).toBeGreaterThan(0);
    const after = (await getDayRows()).find((x) => x.product.code === p.code)!;
    expect(after.baked).toBe(bakedBefore);
    expect((await importProductsJson(text)).baked).toBe(0); // not doubled
  });

  it('refuses garbage and skips rows with a foreign code', async () => {
    await expect(importProductsJson('hello')).rejects.toThrow();
    const r = await importProductsJson(JSON.stringify({ v: 1, products: [
      { name: 'غريب', code: '6285602015254', price: 0 },
      { name: '', code: '2000000000008', price: 0 },
    ] }));
    expect(r).toEqual({ added: 0, skipped: 2, baked: 0 });
  });
});

describe('submitting the day', () => {
  it('locks the baked numbers, lets selling continue, reopens with a count', async () => {
    sql.run('DELETE FROM pos_day_lock');
    const p = await createProduct({ name: 'قفل', price: 100 });
    await addBaked(p.id, 10);
    await lockDay();
    expect(await getDayLock()).toEqual({ locked: true, reopened: 0 });

    await expect(addBaked(p.id, 1)).rejects.toThrow('معتمدة'); // locked
    await recordSale(p); // selling is not blocked
    expect((await getDayRows()).find((r) => r.product.id === p.id)!.sold).toBe(1);

    await unlockDay();
    expect(await getDayLock()).toEqual({ locked: false, reopened: 1 });
    await addBaked(p.id, 2); // editable again
    await lockDay();
    expect((await listDays())[0]).toMatchObject({ locked: true, reopened: 1 });
  });

  it('cannot bake less than was sold, and cannot submit an empty day', async () => {
    sql.run('DELETE FROM pos_day_lock'); // the previous test left today submitted
    const p = await createProduct({ name: 'حد', price: 100 });
    await addBaked(p.id, 5);
    for (let i = 0; i < 3; i++) await recordSale(p);
    await expect(addBaked(p.id, -3)).rejects.toThrow('أقل من المباع'); // would leave 2 < 3
    await addBaked(p.id, -2); // leaves 3 = sold: fine
    sql.run('DELETE FROM pos_baked'); sql.run('DELETE FROM pos_sales'); sql.run('DELETE FROM pos_day_lock');
    await expect(lockDay()).rejects.toThrow('لا توجد كميات');
  });
});

describe("erasing today's list", () => {
  it('nets baked, sold and takings to zero with opposite rows, and leaves other days alone', async () => {
    const a = await createProduct({ name: 'مسح أ', price: 5000 });
    const b = await createProduct({ name: 'مسح ب', price: 800 });
    await addBaked(a.id, 30);
    await addBaked(b.id, 12);
    for (let i = 0; i < 7; i++) await recordSale(a);
    await recordSale(b);
    await addBaked(a.id, 9, '2020-01-01'); // another day

    const out = await eraseDay();
    expect(out.baked).toBeGreaterThanOrEqual(42);
    expect(out.sold).toBeGreaterThanOrEqual(8);
    const rows = await getDayRows();
    const t = totalsOf(rows);
    expect([t.baked, t.sold, t.left, t.revenue]).toEqual([0, 0, 0, 0]);
    expect(rows.filter((r) => r.baked !== 0 || r.sold !== 0)).toHaveLength(0);
    expect((await getDayRows('2020-01-01')).find((r) => r.product.id === a.id)!.baked).toBe(9);
    // erasing an already-empty day does nothing
    expect(await eraseDay()).toEqual({ baked: 0, sold: 0 });
  });

  it('a submitted day is reopened and counted, then erased', async () => {
    const p = await createProduct({ name: 'مسح ج', price: 300 });
    await addBaked(p.id, 20);
    await recordSale(p);
    await lockDay();
    const before = await getDayLock();
    expect(before.locked).toBe(true);
    await eraseDay();
    const after = await getDayLock();
    expect(after.locked).toBe(false);
    expect(after.reopened).toBe(before.reopened + 1);
    expect(totalsOf(await getDayRows()).baked).toBe(0);
  });
});

describe("removing one product from today's list", () => {
  it('reverses only that product — at the prices its sales were made at', async () => {
    const a = await createProduct({ name: 'حذف أ', price: 1000 });
    const b = await createProduct({ name: 'حذف ب', price: 500 });
    await addBaked(a.id, 20); await addBaked(b.id, 10);
    await recordSale(a); await recordSale(a);
    sql.run('UPDATE pos_products SET price = 1500 WHERE id = ?', [a.id]); // a price change mid-day
    await recordSale({ ...a, price: 1500 }); await recordSale(b);

    const out = await removeProductFromDay(a.id);
    expect(out).toEqual({ baked: 20, sold: 3 });
    const rows = await getDayRows();
    const ra = rows.find((r) => r.product.id === a.id)!;
    const rb = rows.find((r) => r.product.id === b.id)!;
    expect([ra.baked, ra.sold, ra.left, ra.revenue]).toEqual([0, 0, 0, 0]); // no phantom takings
    expect([rb.baked, rb.sold]).toEqual([10, 1]);                           // the other is untouched
    expect((await removeProductFromDay(a.id))).toEqual({ baked: 0, sold: 0 }); // nothing left to do
  });

  it('on a submitted day it reopens and counts, like any amendment', async () => {
    const p = await createProduct({ name: 'حذف ج', price: 200 });
    await addBaked(p.id, 5);
    await lockDay();
    const before = await getDayLock();
    await removeProductFromDay(p.id);
    const after = await getDayLock();
    expect([after.locked, after.reopened]).toEqual([false, before.reopened + 1]);
  });
});

describe('carry-over (non-daily) stock', () => {
  it('stock runs across days, ignores the day lock, and is left out of the day totals and the erase', async () => {
    const v = await createProduct({ name: 'خل', price: 700, daily: false });
    const d = await createProduct({ name: 'خبز يومي', price: 100 });
    expect(v.daily).toBe(false);
    await addBaked(v.id, 10, '2020-02-01');          // stocked on an earlier day
    await addBaked(d.id, 5);
    await lockDay();                                  // today is submitted…
    await addBaked(v.id, 4);                          // …stock can still be added
    await recordSale(v); await recordSale(v);

    const rows = await getDayRows();
    const rv = rows.find((r) => r.product.id === v.id)!;
    expect([rv.baked, rv.sold, rv.left]).toEqual([4, 2, 12]); // 10 + 4 − 2
    const t = totalsOf(rows);
    expect(t.sold).toBeGreaterThanOrEqual(2);
    // the vinegar's stock is not today's baking
    expect(rows.filter((r) => r.product.daily).reduce((n, r) => n + r.baked, 0)).toBe(t.baked);

    await eraseDay();                                 // clears the day's list only
    const after = (await getDayRows()).find((r) => r.product.id === v.id)!;
    expect(after.left).toBe(12);
  });

  it('refuses to take stock below what was sold, over all days', async () => {
    const h = await createProduct({ name: 'عسل', price: 9000, daily: false });
    await addBaked(h.id, 3, '2020-03-01');
    await recordSale(h);
    await expect(addBaked(h.id, -3)).rejects.toThrow('أقل من المباع');
    await addBaked(h.id, -2);                         // 3 − 2 = 1 ≥ 1 sold
    expect((await getDayRows()).find((r) => r.product.id === h.id)!.left).toBe(0);
  });

  it('can be switched on an existing product', async () => {
    const p = await createProduct({ name: 'سمن', price: 5000 });
    expect(p.daily).toBe(true);
    await updateProduct(p.id, { name: 'سمن', price: 5000, daily: false });
    expect((await listProducts()).find((x) => x.id === p.id)!.daily).toBe(false);
  });
});
