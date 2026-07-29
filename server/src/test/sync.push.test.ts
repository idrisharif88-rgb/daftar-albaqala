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
//
// The reply is a PER-ROW acknowledgement — `{accepted: [id], rejected: [{id,
// reason}]}` per table — not a set of counts. The client is only allowed to
// forget a local row that appears in `accepted`, so these assertions are what
// stands between a rejected debt and silent data loss.

const AUTH = (token: string) => ({ Authorization: `Bearer ${token}` });

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

  test('inserts a brand-new customer and acknowledges it by id', async () => {
    const id = randomUUID();
    const res = await request(app)
      .post('/sync/push')
      .set(AUTH(tokenA))
      .send({
        customers: [{ id, name: 'علي', phone: '777111222', updated_at: '2026-06-25T10:00:00Z' }],
        transactions: [],
      });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.customers.accepted, [id]);
    assert.deepEqual(res.body.customers.rejected, []);
    const row = await getCustomer(id);
    assert.equal(row?.user_id, userA);
    assert.equal(row?.name, 'علي');
    assert.equal(row?.role, 'customer'); // defaulted
  });

  test('stores the contact role when one is given', async () => {
    const id = randomUUID();
    await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      customers: [{ id, name: 'محل النور', phone: '777', role: 'supplier', updated_at: '2026-06-25T10:00:00Z' }],
      transactions: [],
    });
    const row = await getCustomer(id);
    assert.equal(row?.role, 'supplier');
  });

  test('an unknown role falls back to customer rather than losing the contact', async () => {
    const id = randomUUID();
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      customers: [{ id, name: 'x', phone: '777', role: 'wizard', updated_at: '2026-06-25T10:00:00Z' }],
      transactions: [],
    });
    assert.deepEqual(res.body.customers.accepted, [id]);
    const row = await getCustomer(id);
    assert.equal(row?.role, 'customer');
  });

  test('re-pushing the same customer creates no duplicate and keeps the data', async () => {
    const id = randomUUID();
    const payload = {
      customers: [{ id, name: 'علي', phone: '777111222', updated_at: '2026-06-25T10:00:00Z' }],
      transactions: [],
    };
    await request(app).post('/sync/push').set(AUTH(tokenA)).send(payload);
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send(payload);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.customers.accepted, [id]);
    // Still exactly one row, unchanged — a flaky retry is harmless.
    const [rows] = await pool.query('SELECT * FROM customers WHERE id = ?', [id]);
    assert.equal((rows as unknown[]).length, 1);
    assert.equal((rows as { name: string }[])[0].name, 'علي');
  });

  test('last-write-wins: a STALE edit keeps the newer server copy but is ACCEPTED', async () => {
    const id = randomUUID();
    // Server already has the newer version.
    await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      customers: [{ id, name: 'new', phone: '777', updated_at: '2026-06-25T12:00:00Z' }],
      transactions: [],
    });
    // Phone pushes an OLDER edit (made earlier offline).
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      customers: [{ id, name: 'old', phone: '777', updated_at: '2026-06-25T09:00:00Z' }],
      transactions: [],
    });

    // The row is accounted for — the server's copy won — so the client must be
    // told it can stop resending. Reporting this as a rejection would leave the
    // phone retrying a losing edit on every sync, forever.
    assert.deepEqual(res.body.customers.accepted, [id]);
    const row = await getCustomer(id);
    assert.equal(row?.name, 'new'); // server kept the newer value
  });

  test('last-write-wins: a NEWER edit overwrites the server copy', async () => {
    const id = randomUUID();
    await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      customers: [{ id, name: 'old', phone: '777', updated_at: '2026-06-25T09:00:00Z' }],
      transactions: [],
    });
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      customers: [{ id, name: 'new', phone: '777', updated_at: '2026-06-25T12:00:00Z' }],
      transactions: [],
    });

    assert.deepEqual(res.body.customers.accepted, [id]);
    const row = await getCustomer(id);
    assert.equal(row?.name, 'new');
  });

  test('TENANT ISOLATION: cannot overwrite a customer UUID owned by another tenant', async () => {
    const id = randomUUID();
    // User A owns it.
    await request(app).post('/sync/push').set(AUTH(tokenFor(userA))).send({
      customers: [{ id, name: 'A-owned', phone: '777', updated_at: '2026-06-25T09:00:00Z' }],
      transactions: [],
    });
    // User B tries to push the same UUID with a newer timestamp.
    const res = await request(app).post('/sync/push').set(AUTH(tokenFor(userB))).send({
      customers: [{ id, name: 'B-hijack', phone: '000', updated_at: '2026-06-25T23:00:00Z' }],
      transactions: [],
    });

    assert.deepEqual(res.body.customers.accepted, []);
    assert.deepEqual(res.body.customers.rejected, [{ id, reason: 'foreign_owner' }]);
    const row = await getCustomer(id);
    assert.equal(row?.user_id, userA);   // still A's
    assert.equal(row?.name, 'A-owned');  // untouched
  });

  test('rejects an invalid customer (missing name/phone) with a reason', async () => {
    const id = randomUUID();
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      customers: [{ id, name: '', phone: '' }],
      transactions: [],
    });
    assert.deepEqual(res.body.customers.accepted, []);
    assert.deepEqual(res.body.customers.rejected, [{ id, reason: 'invalid' }]);
  });

  test('inserts a new transaction for an owned customer', async () => {
    const custId = randomUUID();
    const txnId = randomUUID();
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      customers: [{ id: custId, name: 'علي', phone: '777', updated_at: '2026-06-25T10:00:00Z' }],
      transactions: [{ id: txnId, customer_id: custId, type: 'debt', amount: 1500, occurred_at: '2026-06-25T10:05:00Z' }],
    });
    assert.deepEqual(res.body.transactions.accepted, [txnId]);
    assert.equal(await countTransactions(custId), 1);
  });

  test('stores the transaction currency, defaulting to YER when absent', async () => {
    const custId = randomUUID();
    const gold = randomUUID();
    const plain = randomUUID();
    await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      customers: [{ id: custId, name: 'علي', phone: '777', updated_at: '2026-06-25T10:00:00Z' }],
      transactions: [
        { id: gold, customer_id: custId, type: 'debt', amount: 5, currency: 'GOLD' },
        { id: plain, customer_id: custId, type: 'debt', amount: 100 }, // older client
      ],
    });
    const [rows] = await pool.query('SELECT id, currency FROM transactions WHERE customer_id = ?', [custId]);
    const byId = new Map((rows as { id: string; currency: string }[]).map((r) => [r.id, r.currency]));
    assert.equal(byId.get(gold), 'GOLD');
    assert.equal(byId.get(plain), 'YER');
  });

  test('rejects an unrecognised currency instead of filing it as riyals', async () => {
    const custId = randomUUID();
    const txnId = randomUUID();
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      customers: [{ id: custId, name: 'علي', phone: '777', updated_at: '2026-06-25T10:00:00Z' }],
      transactions: [{ id: txnId, customer_id: custId, type: 'debt', amount: 5, currency: 'BTC' }],
    });
    assert.deepEqual(res.body.transactions.rejected, [{ id: txnId, reason: 'invalid' }]);
    assert.equal(await countTransactions(custId), 0);
  });

  test('APPEND-ONLY: re-pushing the same transaction is accepted, never duplicated', async () => {
    const custId = randomUUID();
    const txnId = randomUUID();
    const payload = {
      customers: [{ id: custId, name: 'علي', phone: '777', updated_at: '2026-06-25T10:00:00Z' }],
      transactions: [{ id: txnId, customer_id: custId, type: 'debt', amount: 1500, occurred_at: '2026-06-25T10:05:00Z' }],
    };
    await request(app).post('/sync/push').set(AUTH(tokenA)).send(payload);
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send(payload);

    assert.deepEqual(res.body.transactions.accepted, [txnId]);
    assert.equal(await countTransactions(custId), 1);
  });

  test('a transaction whose customer is unknown is rejected as RETRYABLE', async () => {
    const txnId = randomUUID();
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      customers: [],
      transactions: [{ id: txnId, customer_id: randomUUID(), type: 'debt', amount: 100 }],
    });
    // 'missing_customer', not 'invalid': the contact may simply not have been
    // pushed yet, so the client must keep the row and try again.
    assert.deepEqual(res.body.transactions.rejected, [{ id: txnId, reason: 'missing_customer' }]);
  });

  test('a contact and its debts land in ONE push (contacts are merged first)', async () => {
    const custId = randomUUID();
    const txnId = randomUUID();
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      customers: [{ id: custId, name: 'جديد', phone: '777', updated_at: '2026-06-25T10:00:00Z' }],
      transactions: [{ id: txnId, customer_id: custId, type: 'debt', amount: 50 }],
    });
    assert.deepEqual(res.body.customers.accepted, [custId]);
    assert.deepEqual(res.body.transactions.accepted, [txnId]);
    assert.equal(await countTransactions(custId), 1);
  });

  test('TENANT ISOLATION: cannot attach a transaction to another tenant\'s customer', async () => {
    const custId = randomUUID();
    const txnId = randomUUID();
    // Customer belongs to A.
    await request(app).post('/sync/push').set(AUTH(tokenFor(userA))).send({
      customers: [{ id: custId, name: 'A', phone: '777', updated_at: '2026-06-25T10:00:00Z' }],
      transactions: [],
    });
    // B tries to write a transaction against A's customer.
    const res = await request(app).post('/sync/push').set(AUTH(tokenFor(userB))).send({
      customers: [],
      transactions: [{ id: txnId, customer_id: custId, type: 'debt', amount: 100 }],
    });
    assert.deepEqual(res.body.transactions.accepted, []);
    assert.equal(res.body.transactions.rejected.length, 1);
    assert.equal(await countTransactions(custId), 0);
  });

  test('rejects a transaction with a bad type or non-positive amount', async () => {
    const custId = randomUUID();
    await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      customers: [{ id: custId, name: 'علي', phone: '777', updated_at: '2026-06-25T10:00:00Z' }],
      transactions: [],
    });
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      customers: [],
      transactions: [
        { id: randomUUID(), customer_id: custId, type: 'gift', amount: 100 },
        { id: randomUUID(), customer_id: custId, type: 'debt', amount: -5 },
        { id: randomUUID(), customer_id: custId, type: 'debt', amount: 0 },
      ],
    });
    assert.equal(res.body.transactions.rejected.length, 3);
    assert.ok(res.body.transactions.rejected.every((r: { reason: string }) => r.reason === 'invalid'));
    assert.equal(await countTransactions(custId), 0);
  });

  test('one bad row does not take the good rows down with it', async () => {
    const good = randomUUID();
    const bad = randomUUID();
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      customers: [
        { id: good, name: 'صالح', phone: '777', updated_at: '2026-06-25T10:00:00Z' },
        { id: bad, name: '', phone: '' },
      ],
      transactions: [],
    });
    assert.deepEqual(res.body.customers.accepted, [good]);
    assert.deepEqual(res.body.customers.rejected, [{ id: bad, reason: 'invalid' }]);
    assert.ok(await getCustomer(good));
  });
});
