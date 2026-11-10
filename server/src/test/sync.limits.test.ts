import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor } from './helpers';

// A contact's debt limit and automatic reminder travel with the contact.
// An OLDER app sends a contact without them — that must keep what is stored.

const AUTH = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('sync: debt limit + reminder', () => {
  let user: string; let token: string;

  before(() => { assert.equal(process.env.DB_NAME, 'daftar_test'); });
  beforeEach(async () => {
    await cleanDb();
    user = await seedUser();
    token = tokenFor(user);
  });
  after(async () => { await pool.end(); });

  const contact = (over: Record<string, unknown> = {}, at = '2026-11-10T10:00:00.000Z') => ({
    id: CID, name: 'علي', phone: '777111222', note: null, role: 'customer',
    created_at: '2026-11-10T09:00:00.000Z', updated_at: at, deleted_at: null, ...over,
  });
  let CID = '';
  const push = (c: Record<string, unknown>) =>
    request(app).post('/sync/push').set(AUTH(token)).send({ customers: [c], transactions: [] });
  const stored = async () =>
    ((await pool.query('SELECT debt_limit, reminder_days, reminder_consent FROM customers WHERE id = ?', [CID]))[0] as
      { debt_limit: string | null; reminder_days: number | null; reminder_consent: number }[])[0];

  test('stored on push and returned on pull', async () => {
    CID = randomUUID();
    const res = await push(contact({ debt_limit: 50000, reminder_days: 7, reminder_consent: true }));
    assert.deepEqual(res.body.customers.accepted, [CID]);
    assert.deepEqual(await stored(), { debt_limit: '50000.00', reminder_days: 7, reminder_consent: 1 });
    const pull = await request(app).get('/sync/pull').set(AUTH(token));
    const row = pull.body.customers.find((c: { id: string }) => c.id === CID);
    assert.equal(Number(row.debt_limit), 50000);
    assert.equal(row.reminder_days, 7);
    assert.equal(Number(row.reminder_consent), 1);
  });

  test('an older app (no fields) keeps the stored limit', async () => {
    CID = randomUUID();
    await push(contact({ debt_limit: 50000, reminder_days: 30, reminder_consent: true }));
    await push(contact({ name: 'علي أحمد' }, '2026-11-10T11:00:00.000Z'));
    assert.deepEqual(await stored(), { debt_limit: '50000.00', reminder_days: 30, reminder_consent: 1 });
  });

  test('a newer edit can clear it; bad values become none', async () => {
    CID = randomUUID();
    await push(contact({ debt_limit: 50000, reminder_days: 7, reminder_consent: true }));
    await push(contact({ debt_limit: null, reminder_days: 5, reminder_consent: false }, '2026-11-10T11:00:00.000Z'));
    assert.deepEqual(await stored(), { debt_limit: null, reminder_days: null, reminder_consent: 0 });
    await push(contact({ debt_limit: -3, reminder_days: 14 }, '2026-11-10T12:00:00.000Z'));
    assert.deepEqual(await stored(), { debt_limit: null, reminder_days: 14, reminder_consent: 0 });
  });

  test('a stale edit does not change it', async () => {
    CID = randomUUID();
    await push(contact({ debt_limit: 50000, reminder_days: 7, reminder_consent: true }, '2026-11-10T12:00:00.000Z'));
    await push(contact({ debt_limit: 1, reminder_days: 3, reminder_consent: false }, '2026-11-10T08:00:00.000Z'));
    assert.deepEqual(await stored(), { debt_limit: '50000.00', reminder_days: 7, reminder_consent: 1 });
  });
});
