import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor } from './helpers';

// Per-account settings: the store name, the owner's name and the exchange
// rates. They used to live only in the phone's key/value table, so a reinstall
// or a second device lost them — the notifications went out unsigned and every
// foreign-currency debt lost its riyal reference.
//
// They ride along with /sync as a third table, keyed by name instead of a UUID,
// with last-write-wins per key. Two things are load-bearing here: an OLDER edit
// must never overwrite a newer one (two devices, one account), and a key that
// is not on the allowlist must be refused — the same table on the phone also
// holds the sync cursor and the activation flag, and neither may travel.

const AUTH = (token: string) => ({ Authorization: `Bearer ${token}` });

async function readSetting(userId: string, key: string) {
  const [rows] = await pool.query(
    'SELECT value, updated_at FROM user_settings WHERE user_id = ? AND `key` = ?',
    [userId, key]
  );
  return (rows as { value: string | null; updated_at: Date }[])[0];
}

describe('settings sync', () => {
  let userA: string;
  let userB: string;
  let tokenA: string;
  let tokenB: string;

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
  });

  after(async () => {
    await pool.end();
  });

  test('stores a pushed setting and acknowledges it by key', async () => {
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      customers: [],
      transactions: [],
      settings: [
        { key: 'store_name', value: 'بقالة الأمل', updated_at: '2026-07-30T10:00:00Z' },
        { key: 'rate_SAR', value: '140', updated_at: '2026-07-30T10:00:00Z' },
      ],
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.settings.accepted, ['store_name', 'rate_SAR']);
    assert.deepEqual(res.body.settings.rejected, []);
    assert.equal((await readSetting(userA, 'store_name')).value, 'بقالة الأمل');
    assert.equal((await readSetting(userA, 'rate_SAR')).value, '140');
  });

  test('a newer edit overwrites, an older one does not', async () => {
    await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      settings: [{ key: 'rate_SAR', value: '140', updated_at: '2026-07-30T12:00:00Z' }],
    });

    // Stale push from a device that has been offline — must not win.
    const stale = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      settings: [{ key: 'rate_SAR', value: '100', updated_at: '2026-07-30T09:00:00Z' }],
    });
    // Still an ACCEPT: the key is accounted for, the server's copy just wins.
    assert.deepEqual(stale.body.settings.accepted, ['rate_SAR']);
    assert.equal((await readSetting(userA, 'rate_SAR')).value, '140');

    await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      settings: [{ key: 'rate_SAR', value: '145', updated_at: '2026-07-30T18:00:00Z' }],
    });
    assert.equal((await readSetting(userA, 'rate_SAR')).value, '145');
  });

  test('refuses a key that is not on the allowlist', async () => {
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      settings: [
        // Device-local state that must never cross: syncing a cursor would make
        // one phone rewind another, and account_active is the server's to decide.
        { key: 'sync_since', value: 'v1|...', updated_at: '2026-07-30T10:00:00Z' },
        { key: 'account_active', value: '1', updated_at: '2026-07-30T10:00:00Z' },
      ],
    });

    assert.deepEqual(res.body.settings.accepted, []);
    assert.deepEqual(res.body.settings.rejected, [
      { id: 'sync_since', reason: 'invalid' },
      { id: 'account_active', reason: 'invalid' },
    ]);
    assert.equal(await readSetting(userA, 'sync_since'), undefined);
  });

  test('refuses an oversized value', async () => {
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      settings: [{ key: 'store_name', value: 'x'.repeat(600), updated_at: '2026-07-30T10:00:00Z' }],
    });
    assert.deepEqual(res.body.settings.rejected, [{ id: 'store_name', reason: 'invalid' }]);
  });

  test('pull returns the account settings on every page, cursor or not', async () => {
    await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      settings: [{ key: 'owner_name', value: 'إدريس', updated_at: '2026-07-30T10:00:00Z' }],
    });

    const first = await request(app).get('/sync/pull').set(AUTH(tokenA));
    assert.equal(first.status, 200);
    assert.deepEqual(
      (first.body.settings as { key: string; value: string }[]).map((s) => [s.key, s.value]),
      [['owner_name', 'إدريس']]
    );

    // Settings sit outside the delta cursor: a caught-up client still gets them,
    // so a device that somehow missed one is repaired by the next sync.
    const caughtUp = await request(app)
      .get('/sync/pull')
      .query({ since: first.body.synced_at })
      .set(AUTH(tokenA));
    assert.equal(caughtUp.body.settings.length, 1);
  });

  test('one tenant never sees another tenant settings', async () => {
    await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      settings: [{ key: 'store_name', value: 'بقالة أ', updated_at: '2026-07-30T10:00:00Z' }],
    });
    await request(app).post('/sync/push').set(AUTH(tokenB)).send({
      settings: [{ key: 'store_name', value: 'بقالة ب', updated_at: '2026-07-30T10:00:00Z' }],
    });

    const pullB = await request(app).get('/sync/pull').set(AUTH(tokenB));
    assert.deepEqual(
      (pullB.body.settings as { value: string }[]).map((s) => s.value),
      ['بقالة ب']
    );
    assert.equal((await readSetting(userA, 'store_name')).value, 'بقالة أ');
  });

  test('a push with no settings key still works (older clients)', async () => {
    const res = await request(app).post('/sync/push').set(AUTH(tokenA)).send({
      customers: [], transactions: [],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.settings, { accepted: [], rejected: [] });
  });
});
