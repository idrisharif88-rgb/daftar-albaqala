import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor } from './helpers';

// The owner's report per cashier: sign-in / sign-out times and sales per day.
// The seller is stamped by the server from the token; only the owner reads it.

const AUTH = (t: string) => ({ Authorization: `Bearer ${t}` });
const PASSWORD = 'secret123';

describe('staff report', () => {
  let owner: string; let ownerToken: string; let seq = 0;
  const phone = () => `56${String(seq++).padStart(7, '0')}`;

  before(() => { assert.equal(process.env.DB_NAME, 'daftar_test'); });
  beforeEach(async () => {
    await cleanDb();
    owner = await seedUser();
    await pool.query('UPDATE users SET pos_enabled = 1, pos_staff_enabled = 1 WHERE id = ?', [owner]);
    ownerToken = tokenFor(owner);
  });
  after(async () => { await pool.end(); });

  async function hire(role: string, permissions?: string[]) {
    const p = phone();
    const add = await request(app).post('/pos-staff').set(AUTH(ownerToken))
      .send({ name: `موظف ${role}`, phone: p, role, password: PASSWORD, ...(permissions ? { permissions } : {}) });
    assert.equal(add.status, 201, JSON.stringify(add.body));
    const login = await request(app).post('/auth/staff/login').send({ phone: p, password: PASSWORD });
    return { id: add.body.staff.id as string, token: login.body.token as string };
  }
  const report = (token: string, id: string, from = '2026-11-08', to = '2026-11-09') =>
    request(app).get(`/pos-staff/${id}/report?from=${from}&to=${to}`).set(AUTH(token));

  test('login and logout are recorded; sales are counted for the cashier who made them', async () => {
    const cashier = await hire('cashier');
    const productId = randomUUID();
    await request(app).post('/pos-sync/push').set(AUTH(ownerToken)).send({
      products: [{ id: productId, name: 'خبز', code: '2000000000010', price: 5000,
        created_at: '2026-11-08T05:00:00Z', updated_at: '2026-11-08T05:00:00Z', deleted_at: null }],
    });
    const sale = (day: string, qty: number) => ({
      id: randomUUID(), product_id: productId, day, qty, price: 5000, created_at: `${day}T06:00:00Z`,
    });
    const r = await request(app).post('/pos-sync/push').set(AUTH(cashier.token))
      .send({ sales: [sale('2026-11-08', 2), sale('2026-11-08', 1), sale('2026-11-09', 3), sale('2026-11-09', -1)] });
    assert.equal(r.body.sales.accepted.length, 4, JSON.stringify(r.body));
    // the owner's own sale is not the cashier's
    await request(app).post('/pos-sync/push').set(AUTH(ownerToken)).send({ sales: [sale('2026-11-08', 5)] });

    // move the session into the report's window, then sign out
    await pool.query("UPDATE pos_staff_sessions SET login_at = '2026-11-08 07:00:00' WHERE staff_id = ?", [cashier.id]);
    assert.equal((await request(app).post('/auth/staff/logout').set(AUTH(cashier.token))).status, 200);

    const res = await report(ownerToken, cashier.id);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.days, [
      { day: '2026-11-08', qty: 3, amount: 15000 },
      { day: '2026-11-09', qty: 2, amount: 10000 },
    ]);
    assert.deepEqual(res.body.totals, { qty: 5, amount: 25000 });
    assert.equal(res.body.sessions.length, 1);
    assert.ok(res.body.sessions[0].logout_at);
  });

  test('only the owner reads it — not even a staff manager', async () => {
    const cashier = await hire('cashier');
    const admin = await hire('admin');
    assert.equal((await report(admin.token, cashier.id)).status, 403);
    assert.equal((await report(cashier.token, cashier.id)).status, 403);
  });

  test("another owner's member is not found; bad dates refused", async () => {
    const cashier = await hire('cashier');
    const other = await seedUser();
    await pool.query('UPDATE users SET pos_enabled = 1, pos_staff_enabled = 1 WHERE id = ?', [other]);
    assert.equal((await report(tokenFor(other), cashier.id)).status, 404);
    assert.equal((await report(ownerToken, cashier.id, '2026-11-09', '2026-11-08')).status, 400);
    assert.equal((await report(ownerToken, cashier.id, 'x', '2026-11-08')).status, 400);
  });
});
