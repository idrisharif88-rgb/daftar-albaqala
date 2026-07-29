import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor, mysqlDate } from './helpers';

// Integration tests for GET /sync/pull?since= against a real MySQL test database.
// A second device / reinstall asks "what changed since <cursor>?" and gets back
// the customers (incl. soft-deleted tombstones) and transactions the SERVER has
// written since then, scoped to the calling tenant, plus a cursor to send next.
//
// The delta is keyed on `server_updated_at` — a column MySQL stamps itself —
// not on the created_at/updated_at the phone supplies. Several tests below exist
// specifically to pin that down, because the old behaviour lost rows whenever a
// device's clock was wrong.

// Insert a customer row directly, so the test controls its exact timestamps.
// `serverUpdatedAt` overrides the DB's own stamp, which is how a test can place
// a row before or after a cursor deliberately.
async function insertCustomer(opts: {
  userId: string; name: string; updatedAt: Date; deletedAt?: Date;
  serverUpdatedAt?: Date; role?: string;
}): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO customers
       (id, user_id, name, phone, note, role, created_at, updated_at, deleted_at, server_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, opts.userId, opts.name, '777', null, opts.role ?? 'customer',
     mysqlDate(opts.updatedAt), mysqlDate(opts.updatedAt),
     opts.deletedAt ? mysqlDate(opts.deletedAt) : null,
     mysqlDate(opts.serverUpdatedAt ?? new Date())]
  );
  return id;
}

// Insert a transaction row directly with a chosen created_at / server stamp.
async function insertTxn(opts: {
  userId: string; customerId: string; createdAt: Date;
  serverUpdatedAt?: Date; currency?: string;
}): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO transactions
       (id, user_id, customer_id, type, amount, currency, note, occurred_at, created_at, server_updated_at)
     VALUES (?, ?, ?, 'debt', 100.00, ?, NULL, ?, ?, ?)`,
    [id, opts.userId, opts.customerId, opts.currency ?? 'YER',
     mysqlDate(opts.createdAt), mysqlDate(opts.createdAt),
     mysqlDate(opts.serverUpdatedAt ?? new Date())]
  );
  return id;
}

const AUTH = (token: string) => ({ Authorization: `Bearer ${token}` });

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

    const res = await request(app).get('/sync/pull').set(AUTH(tokenA));
    assert.equal(res.status, 200);
    assert.equal(res.body.customers.length, 1);
    assert.equal(res.body.transactions.length, 1);
  });

  test('`since` returns only rows the SERVER wrote at-or-after it (delta fetch)', async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000); // an hour ago
    const recent = new Date(Date.now() - 60 * 1000);   // a minute ago
    const cOld = await insertCustomer({
      userId: userA, name: 'old', updatedAt: old, serverUpdatedAt: old,
    });
    await insertTxn({ userId: userA, customerId: cOld, createdAt: old, serverUpdatedAt: old });
    const cNew = await insertCustomer({
      userId: userA, name: 'new', updatedAt: recent, serverUpdatedAt: recent,
    });
    await insertTxn({ userId: userA, customerId: cNew, createdAt: recent, serverUpdatedAt: recent });

    const res = await request(app)
      .get('/sync/pull')
      .query({ since: new Date(Date.now() - 30 * 60 * 1000).toISOString() })
      .set(AUTH(tokenA));

    assert.equal(res.status, 200);
    assert.equal(res.body.customers.length, 1);
    assert.equal(res.body.customers[0].name, 'new');
    assert.equal(res.body.transactions.length, 1);
  });

  test('CLOCK SKEW: a row whose phone-supplied dates are in the past is still delivered', async () => {
    // This is the bug the server_updated_at column exists to fix. A device with
    // a wrong clock writes created_at/updated_at years ago; filtering on those
    // would place the row behind every other device's cursor forever.
    const wrongClock = new Date('2019-01-01T00:00:00Z');
    const c = await insertCustomer({
      userId: userA, name: 'ساعة-خاطئة', updatedAt: wrongClock, // server stamp defaults to now
    });
    await insertTxn({ userId: userA, customerId: c, createdAt: wrongClock });

    const res = await request(app)
      .get('/sync/pull')
      .query({ since: new Date(Date.now() - 60 * 1000).toISOString() })
      .set(AUTH(tokenA));

    assert.equal(res.body.customers.length, 1, 'customer with a past date must still be pulled');
    assert.equal(res.body.transactions.length, 1, 'transaction with a past date must still be pulled');
  });

  test('includes soft-deleted customers (tombstones) so deletes propagate', async () => {
    const now = new Date();
    await insertCustomer({
      userId: userA, name: 'محذوف', updatedAt: now, deletedAt: now,
    });

    const res = await request(app)
      .get('/sync/pull')
      .query({ since: new Date(Date.now() - 60 * 1000).toISOString() })
      .set(AUTH(tokenA));

    assert.equal(res.body.customers.length, 1);
    assert.notEqual(res.body.customers[0].deleted_at, null); // tombstone is present
  });

  test('carries the contact role and the transaction currency', async () => {
    const c = await insertCustomer({
      userId: userA, name: 'مورد', updatedAt: new Date(), role: 'supplier',
    });
    await insertTxn({ userId: userA, customerId: c, createdAt: new Date(), currency: 'GOLD' });

    const res = await request(app).get('/sync/pull').set(AUTH(tokenA));
    assert.equal(res.body.customers[0].role, 'supplier');
    assert.equal(res.body.transactions[0].currency, 'GOLD');
  });

  test('TENANT ISOLATION: a pull never returns another tenant\'s rows', async () => {
    await insertCustomer({ userId: userB, name: 'B-secret', updatedAt: new Date() });

    const res = await request(app).get('/sync/pull').set(AUTH(tokenA));
    assert.equal(res.status, 200);
    assert.equal(res.body.customers.length, 0); // A sees none of B's data
  });

  test('returns a cursor that can be fed straight back as the next `since`', async () => {
    const c = await insertCustomer({ userId: userA, name: 'علي', updatedAt: new Date() });
    await insertTxn({ userId: userA, customerId: c, createdAt: new Date() });

    const first = await request(app).get('/sync/pull').set(AUTH(tokenA));
    assert.ok(typeof first.body.synced_at === 'string');
    assert.equal(first.body.has_more, false);

    // Feeding the cursor back must be accepted (and must not error).
    const second = await request(app)
      .get('/sync/pull')
      .query({ since: first.body.synced_at })
      .set(AUTH(tokenA));
    assert.equal(second.status, 200);
  });

  test('PAGING: `limit` caps the page, has_more is set, and the cursor drains the rest', async () => {
    const c = await insertCustomer({ userId: userA, name: 'علي', updatedAt: new Date() });
    for (let i = 0; i < 5; i++) {
      await insertTxn({ userId: userA, customerId: c, createdAt: new Date() });
    }

    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const res: { body: { transactions: { id: string }[]; synced_at: string; has_more: boolean } } =
        await request(app).get('/sync/pull').query(cursor ? { since: cursor, limit: 2 } : { limit: 2 })
          .set(AUTH(tokenA));
      for (const t of res.body.transactions) seen.add(t.id);
      cursor = res.body.synced_at;
      pages++;
      if (!res.body.has_more) break;
      assert.ok(pages < 10, 'pull did not drain — the cursor is not advancing');
    }

    assert.equal(seen.size, 5, 'every transaction must arrive across the pages');
    assert.ok(pages > 1, 'a limit of 2 over 5 rows must take more than one page');
  });

  test('PAGING: rows sharing one timestamp still drain (no stuck cursor)', async () => {
    // Rows written in the same millisecond are what a bulk import or a schema
    // migration produces. A timestamp-only cursor would return the same page
    // forever; the (timestamp, id) keyset must still make progress.
    const sameInstant = new Date();
    const c = await insertCustomer({
      userId: userA, name: 'دفعة', updatedAt: sameInstant, serverUpdatedAt: sameInstant,
    });
    for (let i = 0; i < 5; i++) {
      await insertTxn({
        userId: userA, customerId: c, createdAt: sameInstant, serverUpdatedAt: sameInstant,
      });
    }

    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const res: { body: { transactions: { id: string }[]; synced_at: string; has_more: boolean } } =
        await request(app).get('/sync/pull').query(cursor ? { since: cursor, limit: 2 } : { limit: 2 })
          .set(AUTH(tokenA));
      for (const t of res.body.transactions) seen.add(t.id);
      cursor = res.body.synced_at;
      pages++;
      if (!res.body.has_more) break;
      assert.ok(pages < 10, 'cursor stuck on rows sharing a timestamp');
    }

    assert.equal(seen.size, 5);
  });

  test('rejects a malformed `since` (400)', async () => {
    const res = await request(app)
      .get('/sync/pull')
      .query({ since: 'not-a-date' })
      .set(AUTH(tokenA));
    assert.equal(res.status, 400);
  });
});
