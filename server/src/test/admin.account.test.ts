import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor, mysqlDate, getCustomer } from './helpers';
import { resetAdminLoginState } from '../routes/admin';
import { base32Encode, base32Decode, currentStep, totpAt } from '../admin/totp';

// Watcher: erase a whole account, and rename a store.

const ADMIN_PHONE = '777000111';
const ADMIN_PASSWORD = 'correct horse battery';
const TOTP_SECRET = base32Encode(Buffer.from('12345678901234567890'));

async function adminToken(): Promise<string> {
  const code = totpAt(base32Decode(TOTP_SECRET), currentStep());
  const res = await request(app)
    .post('/admin/login')
    .send({ phone: ADMIN_PHONE, password: ADMIN_PASSWORD, code });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

function codeNow(offsetSteps = 0): string {
  return totpAt(base32Decode(TOTP_SECRET), currentStep() + offsetSteps);
}

async function seedContact(userId: string, name = 'زبون', phone = '711111111'): Promise<string> {
  const id = randomUUID();
  const now = mysqlDate(new Date(Date.now() - 60_000));
  await pool.query(
    `INSERT INTO customers (id, user_id, name, phone, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'supplier', ?, ?)`,
    [id, userId, name, phone, now, now]
  );
  return id;
}

async function seedTxn(userId: string, customerId: string, type: 'debt' | 'payment', amount: number): Promise<string> {
  const id = randomUUID();
  const now = mysqlDate(new Date());
  await pool.query(
    `INSERT INTO transactions (id, user_id, customer_id, type, amount, currency, occurred_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'YER', ?, ?)`,
    [id, userId, customerId, type, amount, now, now]
  );
  return id;
}

describe('/admin — delete account + rename store', () => {
  let token: string;

  before(async () => {
    assert.equal(process.env.DB_NAME, 'daftar_test',
      'refusing to run: DB_NAME must be daftar_test, got ' + process.env.DB_NAME);
    process.env.ADMIN_PHONE = ADMIN_PHONE;
    process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash(ADMIN_PASSWORD, 4);
    process.env.ADMIN_TOTP_SECRET = TOTP_SECRET;
    process.env.ADMIN_JWT_SECRET = 'a'.repeat(64);
  });

  beforeEach(async () => {
    await cleanDb();
    resetAdminLoginState();
    token = await adminToken();
  });

  after(async () => {
    await pool.end();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const phoneOf = async (id: string) =>
    String(((await pool.query('SELECT phone FROM users WHERE id = ?', [id]))[0] as Array<{ phone: string }>)[0].phone);
  const count = async (table: string, userId: string) =>
    Number(((await pool.query(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, [userId]))[0] as Array<{ n: number }>)[0].n);

  test('erases one account and everything of it, and nothing of another', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const ca = await seedContact(a, 'أ', '711111111');
    await seedTxn(a, ca, 'debt', 100);
    const cb = await seedContact(b, 'ب', '722222222');
    await seedTxn(b, cb, 'debt', 50);

    const res = await request(app).delete(`/admin/users/${a}`).set(auth())
      .send({ code: codeNow(1), confirm_phone: await phoneOf(a) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.deleted, true);
    assert.equal(await count('customers', a), 0);
    assert.equal(await count('transactions', a), 0);
    assert.equal(((await pool.query('SELECT id FROM users WHERE id = ?', [a]))[0] as unknown[]).length, 0);
    assert.equal(await count('customers', b), 1);
    assert.equal(await count('transactions', b), 1);
  });

  test('refuses without the matching phone, and without a fresh code', async () => {
    const a = await seedUser();
    const wrong = await request(app).delete(`/admin/users/${a}`).set(auth())
      .send({ code: codeNow(1), confirm_phone: '700000000' });
    assert.equal(wrong.status, 400);
    const noCode = await request(app).delete(`/admin/users/${a}`).set(auth())
      .send({ confirm_phone: await phoneOf(a) });
    assert.equal(noCode.status, 403);
    assert.equal(((await pool.query('SELECT id FROM users WHERE id = ?', [a]))[0] as unknown[]).length, 1);
  });

  test('a shopkeeper token cannot delete an account through /admin', async () => {
    const a = await seedUser();
    const res = await request(app).delete(`/admin/users/${a}`)
      .set({ Authorization: `Bearer ${tokenFor(a)}` })
      .send({ code: codeNow(1), confirm_phone: await phoneOf(a) });
    assert.equal(res.status, 401);
  });

  test('renames the store: the synced setting wins on the phone, and the list shows it', async () => {
    const a = await seedUser();
    // The phone had pushed an older name.
    await pool.query(
      "INSERT INTO user_settings (user_id, `key`, value, updated_at) VALUES (?, 'store_name', 'قديم', ?)",
      [a, mysqlDate(new Date(Date.now() - 3600_000))],
    );
    const res = await request(app).post(`/admin/users/${a}/store-name`).set(auth())
      .send({ code: codeNow(1), store_name: '  بقالة النور ' });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const pull = await request(app).get('/sync/pull').set({ Authorization: `Bearer ${tokenFor(a)}` });
    assert.equal(pull.status, 200);
    const row = (pull.body.settings as Array<{ key: string; value: string }>).find((s) => s.key === 'store_name');
    assert.equal(row?.value, 'بقالة النور');

    const list = await request(app).get('/admin/users').set(auth());
    const mine = (list.body.users as Array<{ id: string; store_name: string }>).find((u) => u.id === a);
    assert.equal(mine?.store_name, 'بقالة النور');
  });

  test('renames the contractor store under its own key only', async () => {
    const a = await seedUser();
    const res = await request(app).post(`/admin/users/${a}/store-name`).set(auth())
      .send({ code: codeNow(1), store_name: 'مقاولات', app: 'contractor' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const [rows] = await pool.query('SELECT `key`, value FROM user_settings WHERE user_id = ?', [a]);
    assert.deepEqual(rows, [{ key: 'contractor_store_name', value: 'مقاولات' }]);
  });
  test('sync off: status none refuses sync but keeps login, and Drive turns on', async () => {
    const a = await seedUser({ status: 'active' });
    const shop = { Authorization: `Bearer ${tokenFor(a)}` };
    assert.equal((await request(app).get('/me').set(shop)).body.user.drive_backup, false);

    const res = await request(app).post(`/admin/users/${a}/status`).set(auth())
      .send({ status: 'none', code: codeNow(1) });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    assert.equal((await request(app).get('/sync/pull').set(shop)).status, 402);
    const me = await request(app).get('/me').set(shop);
    assert.equal(me.status, 200);
    assert.equal(me.body.user.drive_backup, true);
  });
  test('Drive follows the calling app: contractor without sync gets it even when grocery syncs', async () => {
    const a = await seedUser({ status: 'active' }); // grocery on, contractor off (default)
    const shop = { Authorization: `Bearer ${tokenFor(a)}` };
    assert.equal((await request(app).get('/me').set(shop).set('X-App', 'grocery')).body.user.drive_backup, false);
    assert.equal((await request(app).get('/me').set(shop).set('X-App', 'contractor')).body.user.drive_backup, true);
    await pool.query("UPDATE users SET contractor_status = 'active' WHERE id = ?", [a]);
    assert.equal((await request(app).get('/me').set(shop).set('X-App', 'contractor')).body.user.drive_backup, false);
  });
  test('POS access: off by default, the owner switches it per account, /me reports it', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const shopA = { Authorization: `Bearer ${tokenFor(a)}` };
    assert.equal((await request(app).get('/me').set(shopA)).body.user.pos_enabled, false);

    const res = await request(app).post(`/admin/users/${a}/pos`).set(auth())
      .send({ enabled: true, code: codeNow(1) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await request(app).get('/me').set(shopA)).body.user.pos_enabled, true);
    // only that account
    const shopB = { Authorization: `Bearer ${tokenFor(b)}` };
    assert.equal((await request(app).get('/me').set(shopB)).body.user.pos_enabled, false);
    // the Watcher's list shows it
    const list = await request(app).get('/admin/users').set(auth());
    assert.equal(list.body.users.find((u: { id: string }) => u.id === a).pos_enabled, true);
    // a shopkeeper cannot grant it to himself, and a bad body is refused
    assert.equal((await request(app).post(`/admin/users/${a}/pos`).set(shopA).send({ enabled: true })).status, 401);
  });
  test('POS access: a bad body is refused', async () => {
    const a = await seedUser();
    // One authenticator code per change — each request below gets its own test run.
    assert.equal((await request(app).post(`/admin/users/${a}/pos`).set(auth())
      .send({ enabled: 'yes', code: codeNow(1) })).status, 400);
  });
  test('sets a new password: old one stops working, new one signs in', async () => {
    const a = await seedUser();
    const phone = await phoneOf(a);
    // A too-short password is refused without spending the code…
    assert.equal((await request(app).post(`/admin/users/${a}/password`).set(auth())
      .send({ code: codeNow(1), password: '123' })).status, 400);
    // …so the same code still works for the real change.
    const res = await request(app).post(`/admin/users/${a}/password`).set(auth())
      .send({ code: codeNow(1), password: 'NewPass2026' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await request(app).post('/auth/login').send({ phone, password: 'NewPass2026' })).status, 200);
    assert.notEqual((await request(app).post('/auth/login').send({ phone, password: 'pw123456' })).status, 200);
  });

  test('password change needs a fresh code and an admin token', async () => {
    const a = await seedUser();
    assert.equal((await request(app).post(`/admin/users/${a}/password`).set(auth())
      .send({ password: 'NewPass2026' })).status, 403);
    assert.equal((await request(app).post(`/admin/users/${a}/password`)
      .set({ Authorization: `Bearer ${tokenFor(a)}` })
      .send({ code: codeNow(1), password: 'NewPass2026' })).status, 401);
    // Too short: refused (the shopkeeper token above never reached the code gate).
    assert.equal((await request(app).post(`/admin/users/${a}/password`).set(auth())
      .send({ code: codeNow(1), password: '123' })).status, 400);
  });
});
