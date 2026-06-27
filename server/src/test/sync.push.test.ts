import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app from '../app';
import { pool } from '../db';
import {
  cleanDb,
  seedUser,
  tokenFor,
  getCustomer,
  countTransactions,
} from './helpers';

// Integration tests for POST /sync/push against a real MySQL test database.
// The phone uploads what it created/changed offline; the server merges it with
// two rules: customers = upsert + last-write-wins by updated_at; transactions =
// append-only insert-if-new. Re-pushing the same batch must be safe (idempotent),
// and a record carrying another owner's UUID must never be applied.

describe('POST /sync/push', () => {
  let userA: string;
  let userB: string;
  let tokenA: string;

  before(async () => {
    // Fail loudly if pointed at the wrong DB — never run destructive tests on prod.
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

  test('rejects an unauthenticated push (401)', async () => {
    const res = await request(app).post('/sync/push').send({ customers: [], transactions: [] });
    assert.equal(res.status, 401);
  });

  test('inserts a brand-new customer owned by the caller', async () => {
    const id = randomUUID();
    const res = await request(app)
      .post('/sync/push')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        customers: [{ id, name: 'علي', phone: '777111222', updated_at: '2026-06-25T10:00:00Z' }],
        transactions: [],
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.customers.inserted, 1);
    const row = await getCustomer(id);
    assert.equal(row?.user_id, userA);
    assert.equal(row?.name, 'علي');
  });

  test('re-pushing the same customer creates no duplicate and keeps the data', async () => {
    const id = randomUUID();
    const payload = {
      customers: [{ id, name: 'علي', phone: '777111222', updated_at: '2026-06-25T10:00:00Z' }],
      transactions: [],
    };
    await request(app).post('/sync/push').set('Authorization', `Bearer ${tokenA}`).send(payload);
    const res = await request(app).post('/sync/push').set('Authorization', `Bearer ${tokenA}`).send(payload);

    assert.equal(res.status, 200);
    // Still exactly one row, unchanged — a flaky retry is harmless.
    const [rows] = await pool.query('SELECT * FROM customers WHERE id = ?', [id]);
    assert.equal((rows as unknown[]).length, 1);
    assert.equal((rows as { name: string }[])[0].name, 'علي');
  });

  test('last-write-wins: a STALE edit is skipped, the newer server copy stays', async () => {
    const id = randomUUID();
    // Server already has the newer version.
    await request(app).post('/sync/push').set('Authorization', `Bearer ${tokenA}`).send({
      customers: [{ id, name: 'new', phone: '777', updated_at: '2026-06-25T12:00:00Z' }],
      transactions: [],
    });
    // Phone pushes an OLDER edit (made earlier offline).
    const res = await request(app).post('/sync/push').set('Authorization', `Bearer ${tokenA}`).send({
      customers: [{ id, name: 'old', phone: '777', updated_at: '2026-06-25T09:00:00Z' }],
      transactions: [],
    });

    assert.equal(res.body.customers.skipped, 1);
    const row = await getCustomer(id);
    assert.equal(row?.name, 'new'); // server kept the newer value
  });

  test('last-write-wins: a NEWER edit overwrites the server copy', async () => {
    const id = randomUUID();
    await request(app).post('/sync/push').set('Authorization', `Bearer ${tokenA}`).send({
      customers: [{ id, name: 'old', phone: '777', updated_at: '2026-06-25T09:00:00Z' }],
      transactions: [],
    });
    const res = await request(app).post('/sync/push').set('Authorization', `Bearer ${tokenA}`).send({
      customers: [{ id, name: 'new', phone: '777', updated_at: '2026-06-25T12:00:00Z' }],
      transactions: [],
    });

    assert.equal(res.body.customers.updated, 1);
    const row = await getCustomer(id);
    assert.equal(row?.name, 'new');
  });

  test('TENANT ISOLATION: cannot overwrite a customer UUID owned by another tenant', async () => {
    const id = randomUUID();
    // User A owns it.
    await request(app).post('/sync/push').set('Authorization', `Bearer ${tokenFor(userA)}`).send({
      customers: [{ id, name: 'A-owned', phone: '777', updated_at: '2026-06-25T09:00:00Z' }],
      transactions: [],
    });
    // User B tries to push the same UUID with a newer timestamp.
    const res = await request(app).post('/sync/push').set('Authorization', `Bearer ${tokenFor(userB)}`).send({
      customers: [{ id, name: 'B-hijack', phone: '000', updated_at: '2026-06-25T23:00:00Z' }],
      transactions: [],
    });

    assert.equal(res.body.customers.rejected, 1);
    const row = await getCustomer(id);
    assert.equal(row?.user_id, userA);   // still A's
    assert.equal(row?.name, 'A-owned');  // untouched
  });

  test('rejects an invalid customer (missing name/phone)', async () => {
    const res = await request(app).post('/sync/push').set('Authorization', `Bearer ${tokenA}`).send({
      customers: [{ id: randomUUID(), name: '', phone: '' }],
      transactions: [],
    });
    assert.equal(res.body.customers.rejected, 1);
    assert.equal(res.body.customers.inserted, 0);
  });

  test('inserts a new transaction for an owned customer', async () => {
    const custId = randomUUID();
    const txnId = randomUUID();
    const res = await request(app).post('/sync/push').set('Authorization', `Bearer ${tokenA}`).send({
      customers: [{ id: custId, name: 'علي', phone: '777', updated_at: '2026-06-25T10:00:00Z' }],
      transactions: [{ id: txnId, customer_id: custId, type: 'debt', amount: 1500, occurred_at: '2026-06-25T10:05:00Z' }],
    });
    assert.equal(res.body.transactions.inserted, 1);
    assert.equal(await countTransactions(custId), 1);
  });

  test('APPEND-ONLY: re-pushing the same transaction is skipped, never duplicated', async () => {
    const custId = randomUUID();
    const txnId = randomUUID();
    const payload = {
      customers: [{ id: custId, name: 'علي', phone: '777', updated_at: '2026-06-25T10:00:00Z' }],
      transactions: [{ id: txnId, customer_id: custId, type: 'debt', amount: 1500, occurred_at: '2026-06-25T10:05:00Z' }],
    };
    await request(app).post('/sync/push').set('Authorization', `Bearer ${tokenA}`).send(payload);
    const res = await request(app).post('/sync/push').set('Authorization', `Bearer ${tokenA}`).send(payload);

    assert.equal(res.body.transactions.skipped, 1);
    assert.equal(res.body.transactions.inserted, 0);
    assert.equal(await countTransactions(custId), 1);
  });

  test('rejects a transaction whose customer is unknown / not owned', async () => {
    const res = await request(app).post('/sync/push').set('Authorization', `Bearer ${tokenA}`).send({
      customers: [],
      transactions: [{ id: randomUUID(), customer_id: randomUUID(), type: 'debt', amount: 100 }],
    });
    assert.equal(res.body.transactions.rejected, 1);
  });

  test('TENANT ISOLATION: cannot attach a transaction to another tenant\'s customer', async () => {
    const custId = randomUUID();
    // Customer belongs to A.
    await request(app).post('/sync/push').set('Authorization', `Bearer ${tokenFor(userA)}`).send({
      customers: [{ id: custId, name: 'A', phone: '777', updated_at: '2026-06-25T10:00:00Z' }],
      transactions: [],
    });
    // B tries to write a transaction against A's customer.
    const res = await request(app).post('/sync/push').set('Authorization', `Bearer ${tokenFor(userB)}`).send({
      customers: [],
      transactions: [{ id: randomUUID(), customer_id: custId, type: 'debt', amount: 100 }],
    });
    assert.equal(res.body.transactions.rejected, 1);
    assert.equal(await countTransactions(custId), 0);
  });

  test('rejects a transaction with a bad type or non-positive amount', async () => {
    const custId = randomUUID();
    await request(app).post('/sync/push').set('Authorization', `Bearer ${tokenA}`).send({
      customers: [{ id: custId, name: 'علي', phone: '777', updated_at: '2026-06-25T10:00:00Z' }],
      transactions: [],
    });
    const res = await request(app).post('/sync/push').set('Authorization', `Bearer ${tokenA}`).send({
      customers: [],
      transactions: [
        { id: randomUUID(), customer_id: custId, type: 'gift', amount: 100 },
        { id: randomUUID(), customer_id: custId, type: 'debt', amount: -5 },
        { id: randomUUID(), customer_id: custId, type: 'debt', amount: 0 },
      ],
    });
    assert.equal(res.body.transactions.rejected, 3);
    assert.equal(await countTransactions(custId), 0);
  });
});
