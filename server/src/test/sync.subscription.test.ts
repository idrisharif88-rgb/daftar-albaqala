import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor } from './helpers';

// Integration tests for the subscription gate on /sync (requireSubscription).
// Cloud sync is the PAID feature; the server is the enforcement point. Both
// /sync/push and /sync/pull must be refused with 402 unless the tenant's
// subscription is active and unexpired — a tampered client must not get past it.

describe('/sync subscription enforcement', () => {
  before(async () => {
    assert.equal(process.env.DB_NAME, 'daftar_test',
      'refusing to run: DB_NAME must be daftar_test, got ' + process.env.DB_NAME);
  });

  beforeEach(async () => {
    await cleanDb();
  });

  after(async () => {
    await pool.end();
  });

  test('active subscription is allowed (pull)', async () => {
    const user = await seedUser({ status: 'active' });
    const res = await request(app)
      .get('/sync/pull')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    assert.equal(res.status, 200);
  });

  test("status 'none' is refused with 402 (pull)", async () => {
    const user = await seedUser({ status: 'none' });
    const res = await request(app)
      .get('/sync/pull')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    assert.equal(res.status, 402);
    assert.equal(res.body.subscription_status, 'none');
  });

  test("status 'expired' is refused with 402 (push)", async () => {
    const user = await seedUser({ status: 'expired' });
    const res = await request(app)
      .post('/sync/push')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ customers: [], transactions: [] });
    assert.equal(res.status, 402);
  });

  test('active but past expiry date is refused with 402', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const user = await seedUser({ status: 'active', expiresAt: yesterday });
    const res = await request(app)
      .get('/sync/pull')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    assert.equal(res.status, 402);
  });

  test('active with future expiry date is allowed', async () => {
    const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const user = await seedUser({ status: 'active', expiresAt: nextYear });
    const res = await request(app)
      .get('/sync/pull')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    assert.equal(res.status, 200);
  });
});
