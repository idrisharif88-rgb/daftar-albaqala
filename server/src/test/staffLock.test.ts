import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor } from './helpers';

// 4 wrong passwords lock a staff login until the owner sets a new password.

const AUTH = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('staff login lock', () => {
  let ownerToken: string;
  const phone = '571234567';

  before(() => { assert.equal(process.env.DB_NAME, 'daftar_test'); });
  beforeEach(async () => {
    await cleanDb();
    const owner = await seedUser();
    await pool.query('UPDATE users SET pos_enabled = 1, pos_staff_enabled = 1 WHERE id = ?', [owner]);
    ownerToken = tokenFor(owner);
  });
  after(async () => { await pool.end(); });

  const login = (password: string) => request(app).post('/auth/staff/login').send({ phone, password });

  test('4 wrong passwords lock it — even the right one is refused — until a new password', async () => {
    const add = await request(app).post('/pos-staff').set(AUTH(ownerToken))
      .send({ name: 'كاشير', phone, role: 'cashier', password: 'right-one' });
    assert.equal(add.status, 201);
    for (let i = 0; i < 3; i++) assert.equal((await login('wrong-one')).status, 401);
    assert.equal((await login('wrong-one')).status, 423);
    assert.equal((await login('right-one')).status, 423);
    const list = await request(app).get('/pos-staff').set(AUTH(ownerToken));
    assert.equal(list.body.staff[0].locked, true);

    const reset = await request(app).patch(`/pos-staff/${add.body.staff.id}`).set(AUTH(ownerToken))
      .send({ password: 'brand-new' });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.equal(reset.body.staff.locked, false);
    assert.equal((await login('brand-new')).status, 200);
  });

  test('a right password resets the count', async () => {
    await request(app).post('/pos-staff').set(AUTH(ownerToken))
      .send({ name: 'كاشير', phone, role: 'cashier', password: 'right-one' });
    for (let i = 0; i < 3; i++) await login('wrong-one');
    assert.equal((await login('right-one')).status, 200);
    for (let i = 0; i < 3; i++) assert.equal((await login('wrong-one')).status, 401);
  });
});
