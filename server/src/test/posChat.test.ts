import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor } from './helpers';

// Private chat owner ↔ each staff member. A member sees only their own
// conversation; the owner sees all of his; another shop sees none.

const AUTH = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('pos chat', () => {
  let owner: string; let ownerToken: string; let seq = 0;
  before(() => { assert.equal(process.env.DB_NAME, 'daftar_test'); });
  beforeEach(async () => {
    await cleanDb();
    owner = await seedUser();
    await pool.query('UPDATE users SET pos_enabled = 1, pos_staff_enabled = 1 WHERE id = ?', [owner]);
    ownerToken = tokenFor(owner);
  });
  after(async () => { await pool.end(); });

  async function hire(name: string) {
    const phone = `59${String(seq++).padStart(7, '0')}`;
    const add = await request(app).post('/pos-staff').set(AUTH(ownerToken))
      .send({ name, phone, role: 'cashier', password: 'secret123' });
    const login = await request(app).post('/auth/staff/login').send({ phone, password: 'secret123' });
    return { id: add.body.staff.id as string, token: login.body.token as string };
  }

  test('owner and member talk; unread counts; read marks', async () => {
    const a = await hire('علي');
    assert.equal((await request(app).post(`/pos-chat/${a.id}/messages`).set(AUTH(ownerToken)).send({ body: 'أهلاً' })).status, 201);
    assert.equal((await request(app).get('/pos-chat/unread').set(AUTH(a.token))).body.unread, 1);
    const mine = await request(app).get('/pos-chat/me/messages').set(AUTH(a.token));
    assert.deepEqual(mine.body.messages.map((m: { body: string; from_staff: boolean }) => [m.body, m.from_staff]), [['أهلاً', false]]);
    await request(app).post('/pos-chat/me/read').set(AUTH(a.token));
    assert.equal((await request(app).get('/pos-chat/unread').set(AUTH(a.token))).body.unread, 0);

    await request(app).post('/pos-chat/me/messages').set(AUTH(a.token)).send({ body: 'وعليكم السلام' });
    const threads = await request(app).get('/pos-chat/threads').set(AUTH(ownerToken));
    assert.equal(threads.body.threads[0].unread, 1);
    assert.equal(threads.body.threads[0].last_body, 'وعليكم السلام');
    assert.equal((await request(app).get('/pos-chat/unread').set(AUTH(ownerToken))).body.unread, 1);
  });

  test("a member cannot read another member's conversation, nor the thread list", async () => {
    const a = await hire('علي');
    const b = await hire('سالم');
    await request(app).post(`/pos-chat/${a.id}/messages`).set(AUTH(ownerToken)).send({ body: 'سري' });
    assert.equal((await request(app).get(`/pos-chat/${a.id}/messages`).set(AUTH(b.token))).status, 404);
    assert.equal((await request(app).get('/pos-chat/threads').set(AUTH(b.token))).status, 403);
    assert.deepEqual((await request(app).get('/pos-chat/me/messages').set(AUTH(b.token))).body.messages, []);
  });

  test("another shop cannot open this shop's conversation; bad bodies refused", async () => {
    const a = await hire('علي');
    const other = await seedUser();
    await pool.query('UPDATE users SET pos_enabled = 1, pos_staff_enabled = 1 WHERE id = ?', [other]);
    assert.equal((await request(app).get(`/pos-chat/${a.id}/messages`).set(AUTH(tokenFor(other)))).status, 404);
    assert.equal((await request(app).post(`/pos-chat/${a.id}/messages`).set(AUTH(ownerToken)).send({ body: '  ' })).status, 400);
    assert.equal((await request(app).post(`/pos-chat/${a.id}/messages`).set(AUTH(ownerToken)).send({ body: 'x'.repeat(1001) })).status, 400);
  });
});
