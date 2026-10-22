import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor, mysqlDate } from './helpers';

// Attachments — a file pinned to an entry. Metadata lives in MySQL; the bytes
// go to disk under ATTACH_DIR (defaulting under the server's cwd in tests).
// These exercise tenant isolation, the upload gate, and the delta/tombstone
// behaviour the phone sync relies on.

async function seedTxn(userId: string, customerId: string): Promise<string> {
  const id = randomUUID();
  const now = mysqlDate(new Date());
  await pool.query(
    `INSERT INTO transactions (id, user_id, customer_id, type, amount, currency, occurred_at, created_at)
     VALUES (?, ?, ?, 'debt', 100, 'YER', ?, ?)`,
    [id, userId, customerId, now, now],
  );
  return id;
}

async function seedContact(userId: string, phone = '711111111'): Promise<string> {
  const id = randomUUID();
  const now = mysqlDate(new Date());
  await pool.query(
    `INSERT INTO customers (id, user_id, name, phone, role, created_at, updated_at)
     VALUES (?, ?, 'جهة', ?, 'supplier', ?, ?)`,
    [id, userId, phone, now, now],
  );
  return id;
}

// A tiny valid base64 payload — the server validates the MIME allowlist, not
// the bytes, so any content works.
const DATA = Buffer.from('a receipt photo would go here').toString('base64');

describe('/attachments', () => {
  before(() => {
    assert.equal(process.env.DB_NAME, 'daftar_test',
      'refusing to run: DB_NAME must be daftar_test, got ' + process.env.DB_NAME);
  });
  beforeEach(async () => { await cleanDb(); });
  after(async () => { await pool.end(); });

  test('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/attachments?since=');
    assert.equal(res.status, 401);
  });

  test('uploads a file to an own entry, then reads it back', async () => {
    const user = await seedUser();
    const token = tokenFor(user);
    const cust = await seedContact(user);
    const txn = await seedTxn(user, cust);
    const id = randomUUID();

    const up = await request(app)
      .post('/attachments')
      .set('Authorization', `Bearer ${token}`)
      .send({ id, transaction_id: txn, mime: 'image/jpeg', filename: 'فاتورة.jpg', data: DATA });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.attachment.id, id);
    assert.equal(up.body.attachment.transaction_id, txn);
    assert.ok(up.body.attachment.size > 0);

    // list for that entry
    const list = await request(app)
      .get(`/attachments?transaction_id=${txn}`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(list.status, 200);
    assert.equal(list.body.attachments.length, 1);
    assert.equal(list.body.attachments[0].filename, 'فاتورة.jpg');

    // fetch the bytes
    const get = await request(app)
      .get(`/attachments/${id}`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(get.status, 200);
    assert.equal(get.body.data, DATA);
  });

  test('refuses an upload onto another owner\'s entry', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const cust = await seedContact(a);
    const txn = await seedTxn(a, cust); // belongs to A

    const res = await request(app)
      .post('/attachments')
      .set('Authorization', `Bearer ${tokenFor(b)}`) // B tries
      .send({ id: randomUUID(), transaction_id: txn, mime: 'image/jpeg', data: DATA });
    assert.equal(res.status, 404, JSON.stringify(res.body));
  });

  test('refuses to reuse an id that belongs to another account', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const custA = await seedContact(a);
    const txnA = await seedTxn(a, custA);
    const custB = await seedContact(b, '722222222');
    const txnB = await seedTxn(b, custB);
    const id = randomUUID();

    const first = await request(app)
      .post('/attachments')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .send({ id, transaction_id: txnA, mime: 'image/png', data: DATA });
    assert.equal(first.status, 201);

    const second = await request(app)
      .post('/attachments')
      .set('Authorization', `Bearer ${tokenFor(b)}`)
      .send({ id, transaction_id: txnB, mime: 'image/png', data: DATA });
    assert.equal(second.status, 409, JSON.stringify(second.body));
  });

  test('rejects an unsupported file type', async () => {
    const user = await seedUser();
    const cust = await seedContact(user);
    const txn = await seedTxn(user, cust);
    const res = await request(app)
      .post('/attachments')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ id: randomUUID(), transaction_id: txn, mime: 'application/zip', data: DATA });
    assert.equal(res.status, 400);
  });

  test('re-uploading the same id is idempotent (upsert, not a duplicate)', async () => {
    const user = await seedUser();
    const token = tokenFor(user);
    const cust = await seedContact(user);
    const txn = await seedTxn(user, cust);
    const id = randomUUID();
    const body = { id, transaction_id: txn, mime: 'image/jpeg', data: DATA };

    await request(app).post('/attachments').set('Authorization', `Bearer ${token}`).send(body);
    const again = await request(app).post('/attachments').set('Authorization', `Bearer ${token}`).send(body);
    assert.equal(again.status, 201);

    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM attachments WHERE id = ?', [id]);
    assert.equal(Number((rows as { n: number }[])[0].n), 1);
  });

  test('delete is a tombstone: gone from reads, present in the delta', async () => {
    const user = await seedUser();
    const token = tokenFor(user);
    const cust = await seedContact(user);
    const txn = await seedTxn(user, cust);
    const id = randomUUID();
    await request(app).post('/attachments').set('Authorization', `Bearer ${token}`)
      .send({ id, transaction_id: txn, mime: 'image/jpeg', data: DATA });

    const del = await request(app).delete(`/attachments/${id}`).set('Authorization', `Bearer ${token}`);
    assert.equal(del.status, 200);

    // Gone from the entry's active list and from the byte fetch.
    const list = await request(app).get(`/attachments?transaction_id=${txn}`).set('Authorization', `Bearer ${token}`);
    assert.equal(list.body.attachments.length, 0);
    const get = await request(app).get(`/attachments/${id}`).set('Authorization', `Bearer ${token}`);
    assert.equal(get.status, 404);

    // But the tombstone travels on the delta so other devices drop their copy.
    const delta = await request(app).get('/attachments?since=').set('Authorization', `Bearer ${token}`);
    const row = delta.body.attachments.find((a: { id: string }) => a.id === id);
    assert.ok(row, 'deleted row should appear in the delta');
    assert.ok(row.deleted_at, 'it should carry a deleted_at');
  });

  test('delta only returns this owner\'s rows, newer than the cursor', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const custA = await seedContact(a);
    const txnA = await seedTxn(a, custA);
    const custB = await seedContact(b, '733333333');
    const txnB = await seedTxn(b, custB);

    await request(app).post('/attachments').set('Authorization', `Bearer ${tokenFor(a)}`)
      .send({ id: randomUUID(), transaction_id: txnA, mime: 'image/jpeg', data: DATA });
    await request(app).post('/attachments').set('Authorization', `Bearer ${tokenFor(b)}`)
      .send({ id: randomUUID(), transaction_id: txnB, mime: 'image/jpeg', data: DATA });

    const full = await request(app).get('/attachments?since=').set('Authorization', `Bearer ${tokenFor(a)}`);
    assert.equal(full.body.attachments.length, 1, 'A sees only A\'s file');
    assert.ok(full.body.synced_at);

    // Nothing newer than the cursor we were just handed.
    const after = await request(app)
      .get(`/attachments?since=${encodeURIComponent(full.body.synced_at)}`)
      .set('Authorization', `Bearer ${tokenFor(a)}`);
    assert.equal(after.body.attachments.length, 0);
  });
});
