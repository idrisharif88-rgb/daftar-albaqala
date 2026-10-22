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

// Watcher slice 2: the owner opens one account's book, edits / deletes its
// contacts, and deletes or reverses its entries.

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

describe('/admin — one account\'s book', () => {
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

  test('lists contacts with balances, and a contact\'s entries with ids', async () => {
    const user = await seedUser();
    const c = await seedContact(user);
    await seedTxn(user, c, 'debt', 1000);
    const pay = await seedTxn(user, c, 'payment', 300);

    let res = await request(app).get(`/admin/users/${user}/customers`).set(auth());
    assert.equal(res.status, 200);
    assert.equal(res.body.customers.length, 1);
    assert.deepEqual(res.body.customers[0].balances, [{ currency: 'YER', balance: 700 }]);
    assert.equal(res.body.customers[0].transactions_count, 2);

    res = await request(app).get(`/admin/users/${user}/customers/${c}`).set(auth());
    assert.equal(res.status, 200);
    assert.equal(res.body.transactions.length, 2);
    assert.ok(res.body.transactions.some((t: { id: string }) => t.id === pay));
  });

  test('a contact under the wrong account is 404, read or write', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const c = await seedContact(a);
    const t = await seedTxn(a, c, 'debt', 50);
    assert.equal((await request(app).get(`/admin/users/${b}/customers/${c}`).set(auth())).status, 404);
    assert.equal((await request(app).put(`/admin/users/${b}/customers/${c}`).set(auth()).send({ name: 'x' })).status, 404);
    assert.equal((await request(app).delete(`/admin/users/${b}/customers/${c}`).set(auth())).status, 404);
    assert.equal((await request(app).delete(`/admin/users/${b}/transactions/${t}`).set(auth())).status, 404);
    assert.equal((await request(app).post(`/admin/users/${b}/transactions/${t}/reverse`).set(auth())).status, 404);
  });

  test('edit bumps updated_at so the phone accepts it; duplicate phone refused', async () => {
    const user = await seedUser();
    const c = await seedContact(user, 'أ', '711111111');
    await seedContact(user, 'ب', '722222222');
    const before = (await getCustomer(c))!.updated_at as Date;

    let res = await request(app).put(`/admin/users/${user}/customers/${c}`).set(auth())
      .send({ name: 'اسم جديد', role: 'partner' });
    assert.equal(res.status, 200);
    const row = (await getCustomer(c))!;
    assert.equal(row.name, 'اسم جديد');
    assert.equal(row.role, 'partner');
    assert.ok((row.updated_at as Date).getTime() > before.getTime());

    res = await request(app).put(`/admin/users/${user}/customers/${c}`).set(auth()).send({ phone: '722222222' });
    assert.equal(res.status, 409);
    res = await request(app).put(`/admin/users/${user}/customers/${c}`).set(auth()).send({ role: 'boss' });
    assert.equal(res.status, 400);
  });

  test('deleting a contact leaves a tombstone the phone pulls', async () => {
    const user = await seedUser();
    const c = await seedContact(user);
    const res = await request(app).delete(`/admin/users/${user}/customers/${c}`).set(auth());
    assert.equal(res.status, 200);
    assert.ok((await getCustomer(c))!.deleted_at);
    const pull = await request(app).get('/sync/pull').set('Authorization', `Bearer ${tokenFor(user)}`);
    assert.ok(pull.body.customers.find((x: { id: string; deleted_at: unknown }) => x.id === c && x.deleted_at));
  });

  test('deleted entry: gone from balances, tombstone only for apps that ask', async () => {
    const user = await seedUser();
    const c = await seedContact(user);
    const t = await seedTxn(user, c, 'debt', 500);

    const res = await request(app).delete(`/admin/users/${user}/transactions/${t}`).set(auth());
    assert.equal(res.status, 200);
    // Deleting twice is a 404, not a second tombstone.
    assert.equal((await request(app).delete(`/admin/users/${user}/transactions/${t}`).set(auth())).status, 404);

    const book = await request(app).get(`/admin/users/${user}/customers/${c}`).set(auth());
    assert.equal(book.body.transactions.length, 0);
    assert.deepEqual(book.body.customer.balances, []);

    const shop = { Authorization: `Bearer ${tokenFor(user)}` };
    const oldApp = await request(app).get('/sync/pull').set(shop);
    assert.equal(oldApp.body.transactions.length, 0);
    const newApp = await request(app).get('/sync/pull?tombstones=1').set(shop);
    assert.equal(newApp.body.transactions.length, 1);
    assert.ok(newApp.body.transactions[0].deleted_at);

    // A phone re-pushing its copy must not bring it back.
    const push = await request(app).post('/sync/push').set(shop).send({
      transactions: [{
        id: t, customer_id: c, type: 'debt', amount: 500, currency: 'YER', note: null,
        occurred_at: new Date().toISOString(), created_at: new Date().toISOString(),
      }],
    });
    assert.deepEqual(push.body.transactions.accepted, [t]);
    const [rows] = await pool.query('SELECT deleted_at FROM transactions WHERE id = ?', [t]);
    assert.ok((rows as Array<{ deleted_at: unknown }>)[0].deleted_at);
  });

  test('a deleted entry moves forward in the delta cursor', async () => {
    const user = await seedUser();
    const c = await seedContact(user);
    const t = await seedTxn(user, c, 'debt', 500);
    await pool.query('UPDATE transactions SET server_updated_at = NOW(3) - INTERVAL 1 HOUR WHERE id = ?', [t]);
    const shop = { Authorization: `Bearer ${tokenFor(user)}` };
    const first = await request(app).get('/sync/pull?tombstones=1').set(shop);
    const cursor = first.body.synced_at as string;
    assert.equal((await request(app).get(`/sync/pull?tombstones=1&since=${encodeURIComponent(cursor)}`).set(shop)).body.transactions.length, 0);

    await request(app).delete(`/admin/users/${user}/transactions/${t}`).set(auth());
    const after = await request(app).get(`/sync/pull?tombstones=1&since=${encodeURIComponent(cursor)}`).set(shop);
    assert.equal(after.body.transactions.length, 1);
    assert.ok(after.body.transactions[0].deleted_at);
  });

  test('reverse adds the opposite entry and the balance returns to zero', async () => {
    const user = await seedUser();
    const c = await seedContact(user);
    const t = await seedTxn(user, c, 'debt', 1250.5);
    const res = await request(app).post(`/admin/users/${user}/transactions/${t}/reverse`).set(auth());
    assert.equal(res.status, 201);
    assert.equal(res.body.type, 'payment');
    assert.equal(res.body.amount, 1250.5);
    const book = await request(app).get(`/admin/users/${user}/customers/${c}`).set(auth());
    assert.equal(book.body.transactions.length, 2);
    assert.deepEqual(book.body.customer.balances, []);
  });

  test('a shopkeeper token cannot reach these routes', async () => {
    const user = await seedUser();
    const res = await request(app).get(`/admin/users/${user}/customers`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    assert.equal(res.status, 401);
  });
});
