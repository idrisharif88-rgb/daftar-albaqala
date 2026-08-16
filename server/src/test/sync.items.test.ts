import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor, mysqlDate } from './helpers';

// The per-contact price list. It merges like contacts do — upsert by UUID,
// last-write-wins by updated_at, soft-delete by tombstone — but it carries one
// extra rule that the contacts table does not: an item points at a contact, so
// it must be refused unless THAT contact belongs to the pusher. A valid foreign
// key to another tenant's contact is still a leak.

const AUTH = (token: string) => ({ Authorization: `Bearer ${token}` });

async function seedCustomer(userId: string): Promise<string> {
  const id = randomUUID();
  const now = mysqlDate(new Date());
  await pool.query(
    `INSERT INTO customers (id, user_id, name, phone, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'supplier', ?, ?)`,
    [id, userId, 'متجر ماجد', `77${Math.floor(Math.random() * 1e7)}`, now, now]
  );
  return id;
}

/** A cursor timestamp safely past everything already written, read through the
 *  SAME path the pull route compares against (MySQL's clock, via the driver). */
async function mysqlFuture(): Promise<string> {
  const [rows] = await pool.query('SELECT NOW(3) AS now');
  const now = (rows as { now: Date | string }[])[0].now;
  const asDate = now instanceof Date ? now : new Date(String(now));
  return new Date(asDate.getTime() + 60_000).toISOString();
}

async function readItem(id: string) {
  const [rows] = await pool.query('SELECT * FROM items WHERE id = ?', [id]);
  return (rows as Record<string, unknown>[])[0];
}

function anItem(customerId: string, over: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    customer_id: customerId,
    name: 'سكر',
    price: 1500,
    currency: 'YER',
    note: null,
    created_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-08-01T10:00:00Z',
    deleted_at: null,
    ...over,
  };
}

describe('items sync', () => {
  let userA: string;
  let userB: string;
  let tokenA: string;
  let tokenB: string;
  let custA: string;
  let custB: string;

  before(async () => {
    assert.equal(process.env.DB_NAME, 'daftar_test',
      'refusing to run: DB_NAME must be daftar_test, got ' + process.env.DB_NAME);
  });

  beforeEach(async () => {
    await cleanDb();
    userA = await seedUser();
    userB = await seedUser();
    tokenA = tokenFor(userA);
    tokenB = tokenFor(userB);
    custA = await seedCustomer(userA);
    custB = await seedCustomer(userB);
  });

  after(async () => {
    await pool.end();
  });

  test('stores a pushed item and acknowledges it by id', async () => {
    const item = anItem(custA);
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({ items: [item] });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items.accepted, [item.id]);
    assert.deepEqual(res.body.items.rejected, []);
    const stored = await readItem(item.id);
    assert.equal(stored.name, 'سكر');
    assert.equal(Number(stored.price), 1500);
    assert.equal(stored.user_id, userA);
  });

  test('re-pushing the same item changes nothing (idempotent)', async () => {
    const item = anItem(custA);
    await request(app).post('/sync/push').set(AUTH(tokenA)).send({ items: [item] });
    const again = await request(app).post('/sync/push').set(AUTH(tokenA)).send({ items: [item] });

    assert.deepEqual(again.body.items.accepted, [item.id]);
    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM items WHERE customer_id = ?', [custA]);
    assert.equal(Number((rows as { n: number }[])[0].n), 1);
  });

  test('a newer price overwrites; a stale one does not', async () => {
    const item = anItem(custA, { price: 1500, updated_at: '2026-08-01T12:00:00Z' });
    await request(app).post('/sync/push').set(AUTH(tokenA)).send({ items: [item] });

    // Offline device pushing an older edit — the server's copy must stand.
    const stale = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      items: [{ ...item, price: 900, updated_at: '2026-08-01T09:00:00Z' }],
    });
    // Still an accept: the row IS accounted for, so the client should stop
    // resending it. Anything else means it retries forever.
    assert.deepEqual(stale.body.items.accepted, [item.id]);
    assert.equal(Number((await readItem(item.id)).price), 1500);

    await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      items: [{ ...item, price: 1800, updated_at: '2026-08-01T18:00:00Z' }],
    });
    assert.equal(Number((await readItem(item.id)).price), 1800);
  });

  test('TENANT ISOLATION: cannot attach an item to another tenant contact', async () => {
    const item = anItem(custB); // B's contact, pushed by A
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({ items: [item] });

    assert.deepEqual(res.body.items.accepted, []);
    assert.deepEqual(res.body.items.rejected, [{ id: item.id, reason: 'missing_customer' }]);
    assert.equal(await readItem(item.id), undefined);
  });

  test('TENANT ISOLATION: cannot overwrite another tenant item', async () => {
    const item = anItem(custB);
    await request(app).post('/sync/push').set(AUTH(tokenB)).send({ items: [item] });

    // A pushes the SAME uuid, pointing at its own contact.
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      items: [{ ...item, customer_id: custA, name: 'مسروق' }],
    });
    assert.deepEqual(res.body.items.rejected, [{ id: item.id, reason: 'foreign_owner' }]);
    assert.equal((await readItem(item.id)).name, 'سكر');
  });

  test('rejects a nameless item, a negative price and an unknown currency', async () => {
    const bad = [
      anItem(custA, { name: '   ' }),
      anItem(custA, { price: -5 }),
      anItem(custA, { currency: 'EUR' }),
    ];
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({ items: bad });

    assert.deepEqual(res.body.items.accepted, []);
    assert.deepEqual(
      res.body.items.rejected.map((r: { reason: string }) => r.reason),
      ['invalid', 'invalid', 'invalid']
    );
  });

  test('one bad item does not take the good ones down with it', async () => {
    const good = anItem(custA, { name: 'أرز' });
    const bad = anItem(custA, { name: '' });
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      items: [bad, good],
    });

    assert.deepEqual(res.body.items.accepted, [good.id]);
    assert.equal(res.body.items.rejected.length, 1);
    assert.equal((await readItem(good.id)).name, 'أرز');
  });

  test('pull returns items, tombstones included, and only this tenant own', async () => {
    const live = anItem(custA, { name: 'أرز' });
    const gone = anItem(custA, { name: 'ملح', deleted_at: '2026-08-02T10:00:00Z' });
    const theirs = anItem(custB, { name: 'خاص بالآخر' });
    await request(app).post('/sync/push').set(AUTH(tokenA)).send({ items: [live, gone] });
    await request(app).post('/sync/push').set(AUTH(tokenB)).send({ items: [theirs] });

    const res = await request(app).get('/sync/pull').set(AUTH(tokenA));
    assert.equal(res.status, 200);
    const names = (res.body.items as { name: string }[]).map((i) => i.name).sort();
    // The tombstone MUST come through, or a deleted item reappears on the
    // other device at its next pull.
    assert.deepEqual(names, ['أرز', 'ملح']);
  });

  test('a caught-up client is not sent the same items again', async () => {
    const item = anItem(custA);
    await request(app).post('/sync/push').set(AUTH(tokenA)).send({ items: [item] });

    const first = await request(app).get('/sync/pull').set(AUTH(tokenA));
    assert.equal(first.body.items.length, 1);

    // The cursor rewinds a few seconds on drain, so a row that was JUST written
    // can legitimately repeat. Push nothing new and jump the cursor past it.
    //
    // The mark has to come from MYSQL's clock, not Node's: server_updated_at is
    // stamped by the database, and the driver reads DATETIME back through the
    // connection timezone. A Date built here is offset by that difference, so
    // "one minute in the future" by Node's reckoning can still be in the past
    // by the column's — which is what makes a hand-built cursor a bad test.
    const future = await mysqlFuture();
    const caughtUp = await request(app)
      .get('/sync/pull')
      .query({ since: `v2|${future}|zzz|${future}|zzz|${future}|zzz` })
      .set(AUTH(tokenA));
    assert.deepEqual(caughtUp.body.items, []);
  });

  test('a v1 cursor (no items yet) still delivers the whole list', async () => {
    const item = anItem(custA);
    await request(app).post('/sync/push').set(AUTH(tokenA)).send({ items: [item] });

    // An APK installed before the price list existed sends a v1 cursor that is
    // already past the contacts. Its items position must start from zero, not
    // inherit the contacts' — otherwise the list is never delivered at all.
    const future = await mysqlFuture();
    const res = await request(app)
      .get('/sync/pull')
      .query({ since: `v1|${future}|zzz|${future}|zzz` })
      .set(AUTH(tokenA));

    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].id, item.id);
  });

  test('a push with no items key still works (older clients)', async () => {
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      customers: [], transactions: [],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items, { accepted: [], rejected: [] });
  });
});
