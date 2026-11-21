import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor, mysqlDate } from './helpers';
import { base32Decode, base32Encode, currentStep, totpAt } from '../admin/totp';
import { resetAdminLoginState } from '../routes/admin';

// Watcher: one club's subscriptions, read-only (Phase 43, item 9).

const AUTH = (t: string) => ({ Authorization: `Bearer ${t}` });
const ADMIN_PHONE = '777000555';
const ADMIN_PASSWORD = 'club view password';
const TOTP_SECRET = base32Encode(Buffer.from('club-view-secret-123'));

describe('admin club view', () => {
  let user: string; let other: string;
  before(async () => {
    assert.equal(process.env.DB_NAME, 'daftar_test');
    process.env.ADMIN_PHONE = ADMIN_PHONE;
    process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash(ADMIN_PASSWORD, 4);
    process.env.ADMIN_TOTP_SECRET = TOTP_SECRET;
    process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'x'.repeat(40);
  });
  beforeEach(async () => {
    await cleanDb(); resetAdminLoginState();
    user = await seedUser(); other = await seedUser();
  });
  after(async () => { await pool.end(); });

  async function admin(): Promise<string> {
    const r = await request(app).post('/admin/login')
      .send({ phone: ADMIN_PHONE, password: ADMIN_PASSWORD, code: totpAt(base32Decode(TOTP_SECRET), currentStep()) });
    return r.body.token;
  }
  async function member(owner: string): Promise<string> {
    const id = randomUUID(); const now = mysqlDate(new Date());
    await pool.query(`INSERT INTO customers (id, user_id, name, phone, role, created_at, updated_at) VALUES (?, ?, 'م', ?, 'member', ?, ?)`,
      [id, owner, `77${Math.floor(Math.random() * 1e7)}`, now, now]);
    return id;
  }

  test('lists only that account’s live subscriptions, with plain dates', async () => {
    const m = await member(user);
    const sub = { id: randomUUID(), customer_id: m, package_name: 'شهري', days: 30, list_price: 10000, price: 8000,
      currency: 'YER', start_date: '2026-11-21', end_date: '2026-12-20', transaction_id: null, note: null,
      created_at: '2026-11-21T10:00:00Z', updated_at: '2026-11-21T10:00:00Z', deleted_at: null };
    await request(app).post('/sync/push').set(AUTH(tokenFor(user))).send({ club_subscriptions: [sub] });
    const om = await member(other);
    await request(app).post('/sync/push').set(AUTH(tokenFor(other)))
      .send({ club_subscriptions: [{ ...sub, id: randomUUID(), customer_id: om }] });

    const res = await request(app).get(`/admin/users/${user}/club`).set(AUTH(await admin()));
    assert.equal(res.status, 200);
    assert.equal(res.body.subscriptions.length, 1);
    assert.equal(res.body.subscriptions[0].end_date, '2026-12-20');
    assert.equal(res.body.subscriptions[0].price, 8000);
    assert.equal((await request(app).get(`/admin/users/${user}/club`)).status, 401);
  });

  test('a subscriber the user deleted stays visible to the Watcher, flagged; other deleted contacts do not', async () => {
    const m = await member(user);
    await pool.query('UPDATE customers SET deleted_at = UTC_TIMESTAMP() WHERE id = ?', [m]);
    const c = randomUUID(); const now = mysqlDate(new Date());
    await pool.query(`INSERT INTO customers (id, user_id, name, phone, role, created_at, updated_at, deleted_at)
      VALUES (?, ?, 'ز', '771000111', 'customer', ?, ?, UTC_TIMESTAMP())`, [c, user, now, now]);
    const tok = await admin(); // one login: a TOTP code works once
    const res = await request(app).get(`/admin/users/${user}/customers`).set(AUTH(tok));
    const got = res.body.customers.find((x: { id: string }) => x.id === m);
    assert.ok(got && got.deleted_at);
    assert.equal(res.body.customers.some((x: { id: string }) => x.id === c), false);
    // …and it can be opened (read-only), unlike any other deleted contact.
    assert.equal((await request(app).get(`/admin/users/${user}/customers/${m}`).set(AUTH(tok))).status, 200);
    assert.equal((await request(app).get(`/admin/users/${user}/customers/${c}`).set(AUTH(tok))).status, 404);
  });
});
