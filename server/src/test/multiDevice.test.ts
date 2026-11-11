import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor } from './helpers';

// «عدة أجهزة»: each entry carries who recorded it («الاسم · 727»), and /me
// tells the phones whether the switch is on.

const AUTH = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('multi-device', () => {
  let user: string; let token: string;

  before(() => { assert.equal(process.env.DB_NAME, 'daftar_test'); });
  beforeEach(async () => {
    await cleanDb();
    user = await seedUser();
    token = tokenFor(user);
  });
  after(async () => { await pool.end(); });

  const CID = randomUUID();
  const contact = {
    id: CID, name: 'علي', phone: '777111222', note: null, role: 'customer',
    created_at: '2026-11-11T09:00:00.000Z', updated_at: '2026-11-11T09:00:00.000Z', deleted_at: null,
  };
  const txn = (over: Record<string, unknown> = {}) => ({
    id: randomUUID(), customer_id: CID, type: 'debt', amount: 500, currency: 'YER', note: null,
    occurred_at: '2026-11-11T10:00:00.000Z', created_at: '2026-11-11T10:00:00.000Z', ...over,
  });
  const push = (t: Record<string, unknown>) =>
    request(app).post('/sync/push').set(AUTH(token)).send({ customers: [contact], transactions: [t] });
  const pulled = async (id: string) =>
    (await request(app).get('/sync/pull').set(AUTH(token))).body.transactions
      .find((t: { id: string }) => t.id === id);

  test('recorded_by is stored and pulled back', async () => {
    const t = txn({ recorded_by: 'أحمد · 727' });
    assert.deepEqual((await push(t)).body.transactions.accepted, [t.id]);
    assert.equal((await pulled(t.id as string)).recorded_by, 'أحمد · 727');
  });

  test('an older app (no field) stores NULL; an overlong one is cut to 80', async () => {
    const old = txn();
    await push(old);
    assert.equal((await pulled(old.id as string)).recorded_by, null);
    const long = txn({ recorded_by: 'س'.repeat(200) });
    await push(long);
    assert.equal((await pulled(long.id as string)).recorded_by.length, 80);
  });

  test('/me reports the switch', async () => {
    assert.equal((await request(app).get('/me').set(AUTH(token))).body.user.multi_device, false);
    await pool.query('UPDATE users SET multi_device = 1 WHERE id = ?', [user]);
    assert.equal((await request(app).get('/me').set(AUTH(token))).body.user.multi_device, true);
  });
});
