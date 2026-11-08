import { beforeAll, describe, expect, it, vi } from 'vitest';
import initSqlJs from 'sql.js';

// The Drive backup carries the POS section too, and a restore puts it back —
// the day lock included (it is keyed by its day, not an id).
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
vi.mock('./db', () => ({ getDB: async () => adapter, persist: async () => {} }));
vi.mock('./sync', () => ({ runSync: async () => ({ status: 'ok' }) })); // no network in a unit test

import { SCHEMA } from './schema';
import { runMigrations } from './migrations';
import { setMeta } from './meta';
import { buildBackup, applyBackup, isLocalBookEmpty } from './driveBackup';
import { summarizeBackup } from './backupSummary';
import { createProduct, listProducts } from '../features/pos/products';
import { addBaked, recordSale, lockDay, getDayRows, getDayLock } from '../features/pos/stock';

beforeAll(async () => {
  const SQL = await initSqlJs();
  sql = new SQL.Database();
  await adapter.execute(SCHEMA);
  await runMigrations(adapter as never);
  await setMeta('owner_user_id', 'user-1');
});

describe('Drive backup — point of sale', () => {
  it('saves products, baking, sales and the day lock, and restores them', async () => {
    expect(await isLocalBookEmpty()).toBe(true);
    const p = await createProduct({ name: 'خبز تنور', price: 5000 });
    await addBaked(p.id, 40);
    await recordSale(p); await recordSale(p);
    await lockDay();
    expect(await isLocalBookEmpty()).toBe(false); // POS data counts as a book

    const backup = await buildBackup();
    const text = JSON.stringify(backup);
    expect(summarizeBackup(JSON.parse(text))).toMatchObject({ products: 1, sales: 2, isEmpty: false });

    for (const t of ['pos_sales', 'pos_baked', 'pos_day_lock', 'pos_products']) sql.run(`DELETE FROM ${t}`);
    expect(await isLocalBookEmpty()).toBe(true);

    const changed = await applyBackup(JSON.parse(text));
    expect(changed).toBeGreaterThanOrEqual(5);
    const [back] = await listProducts();
    expect([back.name, back.code]).toEqual(['خبز تنور', p.code]);
    const row = (await getDayRows()).find((r) => r.product.id === p.id)!;
    expect([row.baked, row.sold, row.left]).toEqual([40, 2, 38]);
    expect((await getDayLock()).locked).toBe(true);

    // restoring again adds nothing
    expect(await applyBackup(JSON.parse(text))).toBe(0);
  });
});
