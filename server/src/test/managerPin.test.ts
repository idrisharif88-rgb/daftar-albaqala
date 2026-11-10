import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import request from 'supertest';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor } from './helpers';

// «رمز المدير»: set by the owner, handed to staff phones as a salted hash.

const AUTH = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('manager pin', () => {
  let ownerToken: string;
  before(() => { assert.equal(process.env.DB_NAME, 'daftar_test'); });
  beforeEach(async () => {
    await cleanDb();
    const owner = await seedUser();
    await pool.query('UPDATE users SET pos_enabled = 1, pos_staff_enabled = 1 WHERE id = ?', [owner]);
    ownerToken = tokenFor(owner);
  });
  after(async () => { await pool.end(); });

  test('owner sets it; staff receive a salted hash that matches; never the pin itself', async () => {
    assert.equal((await request(app).get('/pos-staff').set(AUTH(ownerToken))).body.manager_pin_set, false);
    assert.equal((await request(app).put('/pos-staff/manager-pin').set(AUTH(ownerToken)).send({ pin: '12a456' })).status, 400);
    for (const weak of ['1234', '111111', '123456', '987654']) {
      assert.equal((await request(app).put('/pos-staff/manager-pin').set(AUTH(ownerToken)).send({ pin: weak })).status, 400, weak);
    }
    assert.equal((await request(app).put('/pos-staff/manager-pin').set(AUTH(ownerToken)).send({ pin: '583920' })).status, 200);
    assert.equal((await request(app).get('/pos-staff').set(AUTH(ownerToken))).body.manager_pin_set, true);

    await request(app).post('/pos-staff').set(AUTH(ownerToken))
      .send({ name: 'كاشير', phone: '581234567', role: 'cashier', password: 'secret123' });
    const login = await request(app).post('/auth/staff/login').send({ phone: '581234567', password: 'secret123' });
    const stored = String(login.body.manager_pin);
    assert.ok(!stored.includes('583920'));
    const [, salt, digest] = stored.split(':');
    assert.equal(createHash('sha256').update(salt + '583920').digest('hex'), digest);
    const me = await request(app).get('/auth/staff/me').set(AUTH(login.body.token));
    assert.equal(me.body.manager_pin, stored);
    // staff cannot set it
    assert.equal((await request(app).put('/pos-staff/manager-pin').set(AUTH(login.body.token)).send({ pin: '583921' })).status, 403);
  });
});
