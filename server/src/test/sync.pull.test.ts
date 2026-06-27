import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor, mysqlDate } from './helpers';

// Integration tests for GET /sync/pull?since= against a real MySQL test database.
// A second device / reinstall asks "what changed since <time>?" and gets back the
// customers (incl. soft-deleted tombstones) and transactions newer-or-equal to
// `since`, scoped to the calling tenant, plus a `synced_at` to use as next `since`.

// Insert a customer row directly, so the test controls its exact timestamps.
async function insertCustomer(opts: {
  userId: string; name: string; updatedAt: Date; deletedAt?: Date;
}): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO customers (id, user_id, name, phone, note, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, opts.userId, opts.name, '777', null, mysqlDate(opts.updatedAt), mysqlDate(opts.updatedAt),
     opts.deletedAt ? mysqlDate(opts.deletedAt) : null]
  );
  return id;
}

// Insert a transaction row directly with a chosen created_at.
async function insertTxn(opts: {
  userId: string; customerId: string; createdAt: Date;
}): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO transactions (id, user_id, customer_id, type, amount, note, occurred_at, created_at)
     VALUES (?, ?, ?, 'debt', 100.00, NULL, ?, ?)`,
    [id, opts.userId, opts.customerId, mysqlDate(opts.createdAt), mysqlDate(opts.createdAt)]
  );
  return id;
}

describe('GET /sync/pull', () => {
  let userA: string;
  let userB: string;
  let tokenA: string;

  before(() => {
    assert.equal(process.env.DB_NAME, 'daftar_test',
      'refusing to run: DB_NAME must be daftar_test, got ' + process.env.DB_NAME);
  });

  beforeEach(async () => {
    await cleanDb();
    userA = await seedUser();
    userB = await seedUser();
    tokenA = tokenFor(userA);
  });

  after(async () => {
    await pool.end();
  });

  test('rejects an unauthenticated pull (401)', async () => {
    const res = await request(app).get('/sync/pull');
    assert.equal(res.status, 401);
  });

  test('with no `since`, returns all of the caller\'s data', async () => {
    const c = await insertCustomer({ userId: userA, name: 'علي', updatedAt: new Date('2026-01-01T00:00:00Z') });
    await insertTxn({ userId: userA, customerId: c, createdAt: new Date('2026-01-02T00:00:00Z') });

    const res = await request(app).get('/sync/pull').set('Authorization', `Bearer ${tokenA}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.customers.length, 1);
    assert.equal(res.body.transactions.length, 1);
  });

  test('`since` returns only rows changed at-or-after it (delta fetch)', async () => {
    const c = await insertCustomer({ userId: userA, name: 'old', updatedAt: new Date('2026-06-01T00:00:00Z') });
    await insertTxn({ userId: userA, customerId: c, createdAt: new Date('2026-06-01T00:00:00Z') });
    const cNew = await insertCustomer({ userId: userA, name: 'new', updatedAt: new Date('2026-06-20T00:00:00Z') });
    await insertTxn({ userId: userA, customerId: cNew, createdAt: new Date('2026-06-20T00:00:00Z') });

    const res = await request(app)
      .get('/sync/pull')
      .query({ since: '2026-06-10T00:00:00Z' })
      .set('Authorization', `Bearer ${tokenA}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.customers.length, 1);
    assert.equal(res.body.customers[0].name, 'new');
    assert.equal(res.body.transactions.length, 1);
  });

  test('includes soft-deleted customers (tombstones) so deletes propagate', async () => {
    await insertCustomer({
      userId: userA, name: 'محذوف', updatedAt: new Date('2026-06-20T00:00:00Z'),
      deletedAt: new Date('2026-06-20T00:00:00Z'),
    });

    const res = await request(app)
      .get('/sync/pull')
      .query({ since: '2026-06-10T00:00:00Z' })
      .set('Authorization', `Bearer ${tokenA}`);

    assert.equal(res.body.customers.length, 1);
    assert.notEqual(res.body.customers[0].deleted_at, null); // tombstone is present
  });

  test('TENANT ISOLATION: a pull never returns another tenant\'s rows', async () => {
    await insertCustomer({ userId: userB, name: 'B-secret', updatedAt: new Date('2026-06-20T00:00:00Z') });

    const res = await request(app).get('/sync/pull').set('Authorization', `Bearer ${tokenA}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.customers.length, 0); // A sees none of B's data
  });

  test('returns a `synced_at` ISO timestamp for the client to store as next `since`', async () => {
    const res = await request(app).get('/sync/pull').set('Authorization', `Bearer ${tokenA}`);
    assert.ok(typeof res.body.synced_at === 'string');
    assert.ok(!Number.isNaN(Date.parse(res.body.synced_at)));
  });

  test('rejects a malformed `since` (400)', async () => {
    const res = await request(app)
      .get('/sync/pull')
      .query({ since: 'not-a-date' })
      .set('Authorization', `Bearer ${tokenA}`);
    assert.equal(res.status, 400);
  });
});
