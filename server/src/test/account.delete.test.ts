import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor, mysqlDate } from './helpers';

// Deleting an account — the route Google Play requires any app with sign-up to
// offer from inside the app.
//
// Two things are being checked, and the second is the dangerous one. That the
// owner's own rows go: obvious. That NOBODY ELSE'S do: this is a DELETE
// filtered by user_id, and the failure mode of a missed filter here is not a
// leak, it is another shopkeeper's book erased with no way back.

const AUTH = (token: string) => ({ Authorization: `Bearer ${token}` });

/** One tenant with a contact, a debt, a price-list item and a saved basket —
 *  a row in every table that a deletion has to reach. */
async function seedBook(userId: string, token: string): Promise<string> {
  const customerId = randomUUID();
  const now = mysqlDate(new Date());
  await pool.query(
    `INSERT INTO customers (id, user_id, name, phone, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'supplier', ?, ?)`,
    [customerId, userId, 'متجر ماجد', `77${Math.floor(Math.random() * 1e7)}`, now, now]
  );
  await request(app).post('/sync/push').set(AUTH(token)).send({
    transactions: [{
      id: randomUUID(), customer_id: customerId, type: 'debt', amount: 500,
      currency: 'YER', note: null,
      occurred_at: '2026-08-20T10:00:00Z', created_at: '2026-08-20T10:00:00Z',
    }],
    items: [{
      id: randomUUID(), customer_id: customerId, name: 'سكر', price: 1500,
      currency: 'YER', note: null,
      created_at: '2026-08-20T10:00:00Z', updated_at: '2026-08-20T10:00:00Z',
      deleted_at: null,
    }],
    item_groups: [{
      id: randomUUID(), customer_id: customerId, name: 'الأسبوعي',
      lines_json: '[{"item_id":"i-1","qty":2}]',
      created_at: '2026-08-20T10:00:00Z', updated_at: '2026-08-20T10:00:00Z',
      deleted_at: null,
    }],
    settings: [{ key: 'owner_name', value: 'إدريس', updated_at: '2026-08-20T10:00:00Z' }],
  });
  return customerId;
}

async function countFor(table: string, userId: string): Promise<number> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, [userId]
  );
  return Number((rows as { n: number }[])[0].n);
}

const TABLES = ['transactions', 'item_groups', 'items', 'customers', 'user_settings'];

describe('DELETE /account', () => {
  let userA: string;
  let userB: string;
  let tokenA: string;
  let tokenB: string;

  before(async () => {
    assert.equal(process.env.DB_NAME, 'daftar_test',
      'refusing to run: DB_NAME must be daftar_test, got ' + process.env.DB_NAME);
  });

  beforeEach(async () => {
    await cleanDb();
    userA = await seedUser();
    userB = await seedUser();
    tokenA = tokenFor(userA);
    tokenB = tokenFor(userB);
  });

  after(async () => {
    await pool.end();
  });

  test('erases the user and every row in every table they own', async () => {
    await seedBook(userA, tokenA);
    for (const table of TABLES) {
      assert.equal(await countFor(table, userA), 1, `${table} should be seeded`);
    }

    const res = await request(app).delete('/account').set(AUTH(tokenA));
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, true);

    for (const table of TABLES) {
      assert.equal(await countFor(table, userA), 0, `${table} should be empty`);
    }
    const [users] = await pool.query('SELECT id FROM users WHERE id = ?', [userA]);
    assert.equal((users as unknown[]).length, 0);
  });

  test('TENANT ISOLATION: another owner book is untouched', async () => {
    await seedBook(userA, tokenA);
    await seedBook(userB, tokenB);

    await request(app).delete('/account').set(AUTH(tokenA));

    // The row that matters. A DELETE with a missing user_id filter erases a
    // stranger's ledger, and there is no undo.
    for (const table of TABLES) {
      assert.equal(await countFor(table, userB), 1, `${table} of the other tenant`);
    }
    const [users] = await pool.query('SELECT id FROM users WHERE id = ?', [userB]);
    assert.equal((users as unknown[]).length, 1);
  });

  test('an account that was never activated can still be deleted', async () => {
    // The likeliest account to be deleted is the one that never worked. It must
    // not be gated behind the same flag that blocked it.
    const blocked = await seedUser({ status: 'none' });
    const token = tokenFor(blocked);

    // Confirm the gate really is shut for this user before proving the point.
    const sync = await request(app).get('/sync/pull').set(AUTH(token));
    assert.equal(sync.status, 402);

    const res = await request(app).delete('/account').set(AUTH(token));
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, true);
  });

  test('rejects an unauthenticated request', async () => {
    const res = await request(app).delete('/account');
    assert.equal(res.status, 401);
  });

  test('the token is inert afterwards — it names a user who is gone', async () => {
    await request(app).delete('/account').set(AUTH(tokenA));
    const me = await request(app).get('/me').set(AUTH(tokenA));
    assert.equal(me.status, 404);
  });
});
