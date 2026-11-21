import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor, mysqlDate } from './helpers';

// «دفتر النادي» (Phase 43, step 3): subscription periods sync like items —
// upsert by UUID, last-write-wins, tombstones, tenant-checked — and the price
// may differ per subscriber (a discount).

const AUTH = (token: string) => ({ Authorization: `Bearer ${token}` });

async function seedMember(userId: string): Promise<string> {
  const id = randomUUID();
  const now = mysqlDate(new Date());
  await pool.query(
    `INSERT INTO customers (id, user_id, name, phone, role, created_at, updated_at)
     VALUES (?, ?, 'علي سالم', ?, 'member', ?, ?)`,
    [id, userId, `77${Math.floor(Math.random() * 1e7)}`, now, now]
  );
  return id;
}

function aSub(customerId: string, over: Record<string, unknown> = {}) {
  return {
    id: randomUUID(), customer_id: customerId, package_name: 'شهري', days: 30,
    list_price: 10000, price: 8000, currency: 'YER',
    start_date: '2026-11-15', end_date: '2026-12-15', transaction_id: randomUUID(), note: null,
    created_at: '2026-11-15T10:00:00Z', updated_at: '2026-11-15T10:00:00Z', deleted_at: null,
    ...over,
  };
}

describe('club subscriptions sync', () => {
  let userA: string; let userB: string; let tokenA: string; let tokenB: string; let memA: string;

  before(() => { assert.equal(process.env.DB_NAME, 'daftar_test'); });
  beforeEach(async () => {
    await cleanDb();
    userA = await seedUser(); userB = await seedUser();
    tokenA = tokenFor(userA); tokenB = tokenFor(userB);
    memA = await seedMember(userA);
  });
  after(async () => { await pool.end(); });

  const push = (token: string, subs: unknown[]) =>
    request(app).post('/sync/push').set(AUTH(token)).send({ club_subscriptions: subs });

  test('a member role and a discounted subscription are stored; pull returns plain dates', async () => {
    const sub = aSub(memA);
    const res = await push(tokenA, [sub]);
    assert.deepEqual(res.body.club_subscriptions, { accepted: [sub.id], rejected: [] });
    const pull = await request(app).get('/sync/pull').set(AUTH(tokenA));
    const got = pull.body.club_subscriptions.find((r: { id: string }) => r.id === sub.id);
    assert.equal(got.start_date, '2026-11-15');
    assert.equal(got.end_date, '2026-12-15');
    assert.equal(Number(got.price), 8000);
    assert.equal(Number(got.list_price), 10000);
    assert.ok(String(pull.body.synced_at).startsWith('v4|'));
  });

  test('last write wins; a stale edit is acknowledged but ignored; tombstones travel', async () => {
    const sub = aSub(memA);
    await push(tokenA, [sub]);
    await push(tokenA, [{ ...sub, price: 7000, updated_at: '2026-11-16T10:00:00Z' }]);
    await push(tokenA, [{ ...sub, price: 1, updated_at: '2026-11-15T09:00:00Z' }]);
    const [rows] = await pool.query('SELECT price FROM club_subscriptions WHERE id = ?', [sub.id]);
    assert.equal(Number((rows as Array<{ price: string }>)[0].price), 7000);
    await push(tokenA, [{ ...sub, price: 7000, deleted_at: '2026-11-17T10:00:00Z', updated_at: '2026-11-17T10:00:00Z' }]);
    const pull = await request(app).get('/sync/pull').set(AUTH(tokenA));
    assert.ok(pull.body.club_subscriptions.find((r: { id: string; deleted_at: unknown }) => r.id === sub.id).deleted_at);
  });

  test('tenant isolation: another owner cannot attach to or overwrite this member', async () => {
    const sub = aSub(memA);
    await push(tokenA, [sub]);
    const foreign = await push(tokenB, [{ ...sub, price: 1, updated_at: '2026-12-01T00:00:00Z' }]);
    assert.equal(foreign.body.club_subscriptions.rejected[0].reason, 'foreign_owner');
    const other = await push(tokenB, [aSub(memA)]);
    assert.equal(other.body.club_subscriptions.rejected[0].reason, 'missing_customer');
    const pullB = await request(app).get('/sync/pull').set(AUTH(tokenB));
    assert.equal(pullB.body.club_subscriptions.length, 0);
  });

  test('invalid rows are refused', async () => {
    const bad = [
      aSub(memA, { days: 0 }),
      aSub(memA, { price: -5 }),
      aSub(memA, { start_date: '2026-13-40' }),
      aSub(memA, { end_date: '2026-11-01' }),
      aSub(memA, { currency: 'XXX' }),
      aSub(memA, { package_name: '' }),
    ];
    const res = await push(tokenA, bad);
    assert.equal(res.body.club_subscriptions.rejected.length, bad.length);
  });

  test('a whole club round-trip in one push: member, its debt, the subscription, the packages', async () => {
    const mid = randomUUID(); const tid = randomUUID();
    const packages = JSON.stringify([{ id: 'p1', name: 'شهري', days: 30, price: 1000000, currency: 'YER' }]);
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      customers: [{ id: mid, name: 'خالد', phone: '771999888', role: 'member', note: null,
        created_at: '2026-11-21T09:00:00Z', updated_at: '2026-11-21T09:00:00Z', deleted_at: null }],
      transactions: [{ id: tid, customer_id: mid, type: 'debt', amount: 8000, currency: 'YER',
        note: 'اشتراك شهري', occurred_at: '2026-11-21T09:00:00Z', created_at: '2026-11-21T09:00:00Z' }],
      club_subscriptions: [aSub(mid, { transaction_id: tid })],
      settings: [{ key: 'club_packages', value: packages, updated_at: '2026-11-21T09:00:00Z' }],
    });
    assert.deepEqual(res.body.customers.rejected, []);
    assert.deepEqual(res.body.transactions.rejected, []);
    assert.deepEqual(res.body.club_subscriptions.rejected, []);
    assert.deepEqual(res.body.settings.rejected, []);
    // A second device pulls everything back, the role intact.
    const pull = await request(app).get('/sync/pull').set(AUTH(tokenA));
    assert.equal(pull.body.customers.find((c: { id: string }) => c.id === mid).role, 'member');
    assert.ok(pull.body.transactions.some((t: { id: string }) => t.id === tid));
    assert.equal(pull.body.club_subscriptions.find((x: { customer_id: string }) => x.customer_id === mid).transaction_id, tid);
    assert.equal(pull.body.settings.find((x: { key: string }) => x.key === 'club_packages').value, packages);
  });

  test('a v3 cursor starts the subscriptions from zero', async () => {
    const sub = aSub(memA);
    await push(tokenA, [sub]);
    const [clock] = await pool.query('SELECT NOW(3) AS now');
    const now = (clock as { now: Date | string }[])[0].now;
    const future = new Date((now instanceof Date ? now : new Date(String(now))).getTime() + 60_000).toISOString();
    const res = await request(app).get('/sync/pull').set(AUTH(tokenA))
      .query({ since: `v3|${future}|zzz|${future}|zzz|${future}|zzz|${future}|zzz` });
    assert.equal(res.status, 200);
    assert.ok(res.body.club_subscriptions.some((r: { id: string }) => r.id === sub.id));
  });
});
