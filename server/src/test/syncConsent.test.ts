import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor } from './helpers';
import { base32Decode, base32Encode, currentStep, totpAt } from '../admin/totp';
import { resetAdminLoginState } from '../routes/admin';
import bcrypt from 'bcryptjs';

// Server-sync CONSENT: the developer switching sync on is a request; the
// shopkeeper's own app answers it; until it says yes the server keeps nothing.

const AUTH = (t: string) => ({ Authorization: `Bearer ${t}` });
const ADMIN_PHONE = '777000222';
const ADMIN_PASSWORD = 'consent test password';
const TOTP_SECRET = base32Encode(Buffer.from('abcdefghij0123456789'));
const codeAt = (offset = 0) => totpAt(base32Decode(TOTP_SECRET), currentStep() + offset);

describe('sync consent', () => {
  let user: string; let token: string;

  before(async () => {
    assert.equal(process.env.DB_NAME, 'daftar_test');
    process.env.ADMIN_PHONE = ADMIN_PHONE;
    process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash(ADMIN_PASSWORD, 4);
    process.env.ADMIN_TOTP_SECRET = TOTP_SECRET;
    process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'x'.repeat(40);
  });
  beforeEach(async () => {
    await cleanDb();
    resetAdminLoginState();
    user = await seedUser({ status: 'none' });
    token = tokenFor(user);
  });
  after(async () => { await pool.end(); });

  const consent = async () =>
    ((await pool.query('SELECT sync_consent FROM users WHERE id = ?', [user]))[0] as { sync_consent: string }[])[0].sync_consent;
  const pull = () => request(app).get('/sync/pull').set(AUTH(token));

  async function adminToken(): Promise<string> {
    resetAdminLoginState();
    const login = await request(app).post('/admin/login')
      .send({ phone: ADMIN_PHONE, password: ADMIN_PASSWORD, code: codeAt() });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    return login.body.token;
  }
  const askUser = async () =>
    request(app).post(`/admin/users/${user}/sync-request`).set(AUTH(await adminToken()));
  const setStatus = async (status: string, extra: Record<string, unknown> = {}) =>
    request(app).post(`/admin/users/${user}/status`).set(AUTH(await adminToken()))
      .send({ status, code: codeAt(1), ...extra });
  const answer = (approve: boolean) =>
    request(app).post('/account/sync-consent').set(AUTH(token)).send({ approve });

  test('the request asks; switching on is refused until the user agrees', async () => {
    const asked = await askUser();
    assert.equal(asked.status, 200);
    assert.equal(asked.body.sync_consent, 'pending');
    const me = await request(app).get('/me').set(AUTH(token));
    assert.equal(me.body.user.sync_consent, 'pending');
    assert.equal((await setStatus('active')).status, 409);
    await answer(true);
    assert.equal((await setStatus('active')).status, 200);
    assert.equal((await pull()).status, 200);
  });

  test('a refusal keeps sync off; a new request asks again', async () => {
    await askUser();
    await answer(false);
    assert.equal(await consent(), 'rejected');
    assert.equal((await setStatus('active')).status, 409);
    await askUser();
    assert.equal(await consent(), 'pending');
  });

  test('withdrawing in the app stops sync', async () => {
    await askUser(); await answer(true); await setStatus('active');
    assert.equal((await pull()).status, 200);
    await answer(false);
    assert.equal((await pull()).status, 402);
  });

  test('switching sync OFF forgets the answer: the next time starts with a request', async () => {
    await askUser(); await answer(true); await setStatus('active');
    assert.equal((await setStatus('none')).status, 200);
    assert.equal(await consent(), 'none');
    assert.equal((await setStatus('active')).status, 409);
  });

  test("…but not while the account's other app still syncs on that yes", async () => {
    await askUser(); await answer(true);
    await setStatus('active', { app: 'contractor' });
    await setStatus('active');
    await setStatus('none');
    assert.equal(await consent(), 'approved');
  });

  test('a request is a no-op for a user who already agreed', async () => {
    await pool.query("UPDATE users SET sync_consent = 'approved' WHERE id = ?", [user]);
    assert.equal((await askUser()).body.sync_consent, 'approved');
  });

  test('only the shopkeeper answers: a bad body, no token, a staff token are all refused', async () => {
    assert.equal((await request(app).post('/account/sync-consent').set(AUTH(token)).send({ approve: 'yes' })).status, 400);
    assert.equal((await request(app).post('/account/sync-consent').send({ approve: true })).status, 401);
    // a token shaped like a staff token is refused by requireAuth
    const jwt = await import('jsonwebtoken');
    const staffish = jwt.default.sign({ sub: user, typ: 'staff', tv: 0 }, process.env.JWT_SECRET as string);
    assert.equal((await request(app).post('/account/sync-consent').set(AUTH(staffish)).send({ approve: true })).status, 401);
    assert.equal(await consent(), 'none');
  });

  test('the Watcher lists the answer', async () => {
    await askUser();
    const list = await request(app).get('/admin/users').set(AUTH(await adminToken()));
    assert.equal(list.body.users[0].sync_consent, 'pending');
  });
});
