import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor, mysqlDate } from './helpers';

// Saved baskets — «المجموعات». A named set of a contact's items, so the week's
// usual purchase is one tap instead of eight.
//
// They merge exactly as items do (upsert by UUID, last-write-wins, tombstones)
// and carry the same tenant rule: a group points at a contact, so it is refused
// unless THAT contact belongs to the pusher.
//
// `lines_json` is opaque JSON text here on purpose — the ids inside it only
// mean anything against the contact's price list on the phone. The server's job
// is to store it byte-for-byte and to check who it belongs to. (Named for the
// column, which cannot be `lines`: MySQL reserves that word.)

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

async function readGroup(id: string) {
  const [rows] = await pool.query('SELECT * FROM item_groups WHERE id = ?', [id]);
  return (rows as Record<string, unknown>[])[0];
}

const LINES = JSON.stringify([{ item_id: 'i-1', qty: 3 }, { item_id: 'i-2', qty: 1 }]);

function aGroup(customerId: string, over: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    customer_id: customerId,
    name: 'الطلب الأسبوعي',
    lines_json: LINES,
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
    deleted_at: null,
    ...over,
  };
}

describe('item groups sync', () => {
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

  test('stores a pushed group and acknowledges it by id', async () => {
    const group = aGroup(custA);
    const res = await request(app).post('/sync/push').set(AUTH(tokenA))
      .send({ item_groups: [group] });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.item_groups.accepted, [group.id]);
    assert.deepEqual(res.body.item_groups.rejected, []);
    const stored = await readGroup(group.id);
    assert.equal(stored.name, 'الطلب الأسبوعي');
    assert.equal(stored.user_id, userA);
    // Stored verbatim: the client parses it, the server never does.
    assert.equal(stored.lines_json, LINES);
  });

  test('re-pushing the same group changes nothing (idempotent)', async () => {
    const group = aGroup(custA);
    await request(app).post('/sync/push').set(AUTH(tokenA)).send({ item_groups: [group] });
    const again = await request(app).post('/sync/push').set(AUTH(tokenA))
      .send({ item_groups: [group] });

    assert.deepEqual(again.body.item_groups.accepted, [group.id]);
    const [rows] = await pool.query(
      'SELECT COUNT(*) AS n FROM item_groups WHERE customer_id = ?', [custA]
    );
    assert.equal(Number((rows as { n: number }[])[0].n), 1);
  });

  test('a newer edit overwrites; a stale one does not', async () => {
    const group = aGroup(custA, { updated_at: '2026-08-20T12:00:00Z' });
    await request(app).post('/sync/push').set(AUTH(tokenA)).send({ item_groups: [group] });

    const stale = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      item_groups: [{ ...group, name: 'قديم', updated_at: '2026-08-20T09:00:00Z' }],
    });
    // Still an accept: the row IS accounted for, so the client stops resending.
    assert.deepEqual(stale.body.item_groups.accepted, [group.id]);
    assert.equal((await readGroup(group.id)).name, 'الطلب الأسبوعي');

    await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      item_groups: [{ ...group, name: 'الطلب الشهري', updated_at: '2026-08-20T18:00:00Z' }],
    });
    assert.equal((await readGroup(group.id)).name, 'الطلب الشهري');
  });

  test('TENANT ISOLATION: cannot attach a group to another tenant contact', async () => {
    const group = aGroup(custB); // B's contact, pushed by A
    const res = await request(app).post('/sync/push').set(AUTH(tokenA))
      .send({ item_groups: [group] });

    assert.deepEqual(res.body.item_groups.accepted, []);
    assert.deepEqual(res.body.item_groups.rejected,
      [{ id: group.id, reason: 'missing_customer' }]);
    assert.equal(await readGroup(group.id), undefined);
  });

  test('TENANT ISOLATION: cannot overwrite another tenant group', async () => {
    const group = aGroup(custB);
    await request(app).post('/sync/push').set(AUTH(tokenB)).send({ item_groups: [group] });

    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      item_groups: [{ ...group, customer_id: custA, name: 'مسروق' }],
    });
    assert.deepEqual(res.body.item_groups.rejected, [{ id: group.id, reason: 'foreign_owner' }]);
    assert.equal((await readGroup(group.id)).name, 'الطلب الأسبوعي');
  });

  test('rejects a nameless group and an oversized membership', async () => {
    const bad = [
      aGroup(custA, { name: '   ' }),
      // TEXT truncation would turn a long basket into broken JSON rather than
      // a shorter one, so the size is checked instead of trusted.
      aGroup(custA, { lines_json: JSON.stringify([{ item_id: 'x'.repeat(9000), qty: 1 }]) }),
    ];
    const res = await request(app).post('/sync/push').set(AUTH(tokenA))
      .send({ item_groups: bad });

    assert.deepEqual(res.body.item_groups.accepted, []);
    assert.deepEqual(
      res.body.item_groups.rejected.map((r: { reason: string }) => r.reason),
      ['invalid', 'invalid']
    );
  });

  test('pull returns groups, tombstones included, and only this tenant own', async () => {
    const live = aGroup(custA, { name: 'الأسبوعي' });
    const gone = aGroup(custA, { name: 'ملغاة', deleted_at: '2026-08-21T10:00:00Z' });
    const theirs = aGroup(custB, { name: 'خاصة بالآخر' });
    await request(app).post('/sync/push').set(AUTH(tokenA))
      .send({ item_groups: [live, gone] });
    await request(app).post('/sync/push').set(AUTH(tokenB)).send({ item_groups: [theirs] });

    const res = await request(app).get('/sync/pull').set(AUTH(tokenA));
    assert.equal(res.status, 200);
    const names = (res.body.item_groups as { name: string }[]).map((g) => g.name).sort();
    // The tombstone MUST come through, or a group deleted on one phone comes
    // back on the other at its next pull.
    assert.deepEqual(names, ['الأسبوعي', 'ملغاة']);
  });

  test('a v2 cursor (no groups yet) still delivers the whole set', async () => {
    const group = aGroup(custA);
    await request(app).post('/sync/push').set(AUTH(tokenA)).send({ item_groups: [group] });

    // An APK installed before saved baskets sends a v2 cursor already past the
    // other three tables. Its groups position must start from zero, or the
    // baskets are never delivered at all.
    const future = await mysqlFuture();
    const res = await request(app)
      .get('/sync/pull')
      .query({ since: `v2|${future}|zzz|${future}|zzz|${future}|zzz` })
      .set(AUTH(tokenA));

    assert.equal(res.status, 200);
    assert.equal(res.body.item_groups.length, 1);
    assert.equal(res.body.item_groups[0].id, group.id);
    assert.ok(String(res.body.synced_at).startsWith('v3|'));
  });

  test('a caught-up client is not sent the same groups again', async () => {
    const group = aGroup(custA);
    await request(app).post('/sync/push').set(AUTH(tokenA)).send({ item_groups: [group] });

    const first = await request(app).get('/sync/pull').set(AUTH(tokenA));
    assert.equal(first.body.item_groups.length, 1);

    // The mark has to come from MYSQL's clock, not Node's — see the note in
    // sync.items.test.ts.
    const future = await mysqlFuture();
    const caughtUp = await request(app)
      .get('/sync/pull')
      .query({ since: `v3|${future}|zzz|${future}|zzz|${future}|zzz|${future}|zzz` })
      .set(AUTH(tokenA));
    assert.deepEqual(caughtUp.body.item_groups, []);
  });

  test('a push with no item_groups key still works (older clients)', async () => {
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      customers: [], transactions: [],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.item_groups, { accepted: [], rejected: [] });
  });
});
