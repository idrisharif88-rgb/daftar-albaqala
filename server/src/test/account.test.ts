import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor } from './helpers';

// Integration tests for POST /account/request-activation. The key property: it
// is NOT behind requireSubscription — an INACTIVE account (the one that needs
// activation) must be able to send the request. It stamps activation_requested_at
// (and an optional message) on the user row for the owner to see.

async function activationRow(userId: string): Promise<Record<string, unknown>> {
  const [rows] = await pool.query(
    'SELECT activation_requested_at, activation_message FROM users WHERE id = ?',
    [userId]
  );
  return (rows as Record<string, unknown>[])[0];
}

describe('/account/request-activation', () => {
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

  test('requires auth (401 without a token)', async () => {
    const res = await request(app).post('/account/request-activation').send({});
    assert.equal(res.status, 401);
  });

  test('an INACTIVE account can request activation (not subscription-gated)', async () => {
    const user = await seedUser({ status: 'none' });
    const res = await request(app)
      .post('/account/request-activation')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ message: 'دفعت عبر الكريمي' });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.requested_at, 'returns a requested_at timestamp');

    const row = await activationRow(user);
    assert.ok(row.activation_requested_at, 'stamps activation_requested_at');
    assert.equal(row.activation_message, 'دفعت عبر الكريمي');
  });

  test('message is optional — absent stores NULL', async () => {
    const user = await seedUser({ status: 'none' });
    const res = await request(app)
      .post('/account/request-activation')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({});

    assert.equal(res.status, 200);
    const row = await activationRow(user);
    assert.ok(row.activation_requested_at);
    assert.equal(row.activation_message, null);
  });

  test('blank/whitespace message stores NULL', async () => {
    const user = await seedUser({ status: 'none' });
    await request(app)
      .post('/account/request-activation')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ message: '   ' });

    const row = await activationRow(user);
    assert.equal(row.activation_message, null);
  });

  test('only the caller\'s own row is stamped (tenant isolation)', async () => {
    const me = await seedUser({ status: 'none' });
    const other = await seedUser({ status: 'none' });
    await request(app)
      .post('/account/request-activation')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .send({ message: 'mine' });

    assert.ok((await activationRow(me)).activation_requested_at);
    assert.equal((await activationRow(other)).activation_requested_at, null);
  });
});
