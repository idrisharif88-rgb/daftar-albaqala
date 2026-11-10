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

  async function adminActivate(): Promise<void> {
    resetAdminLoginState();
    const login = await request(app).post('/admin/login')
      .send({ phone: ADMIN_PHONE, password: ADMIN_PASSWORD, code: codeAt() });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    const res = await request(app).post(`/admin/users/${user}/status`).set(AUTH(login.body.token))
      .send({ status: 'active', code: codeAt(1) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }

  test('switching sync on ASKS — the server still refuses until the shopkeeper approves', async () => {
    await adminActivate();
    assert.equal(await consent(), 'pending');
    const refused = await pull();
    assert.equal(refused.status, 402);
    assert.equal(refused.body.sync_consent, 'pending');
    const me = await request(app).get('/me').set(AUTH(token));
    assert.equal(me.body.user.sync_consent, 'pending');

    const ok = await request(app).post('/account/sync-consent').set(AUTH(token)).send({ approve: true });
    assert.equal(ok.status, 200);
    assert.equal((await pull()).status, 200);
  });

  test('rejecting, or withdrawing later, stops sync', async () => {
    await adminActivate();
    await request(app).post('/account/sync-consent').set(AUTH(token)).send({ approve: false });
    assert.equal(await consent(), 'rejected');
    assert.equal((await pull()).status, 402);
    await request(app).post('/account/sync-consent').set(AUTH(token)).send({ approve: true });
    assert.equal((await pull()).status, 200);
    await request(app).post('/account/sync-consent').set(AUTH(token)).send({ approve: false }); // withdraw
    assert.equal((await pull()).status, 402);
  });

  test('an approval stands: switching sync off and on again does not ask twice', async () => {
    await pool.query("UPDATE users SET sync_consent = 'approved' WHERE id = ?", [user]);
    await adminActivate();
    assert.equal(await consent(), 'approved');
    assert.equal((await pull()).status, 200);
  });

  test('switching sync OFF forgets the answer: the next switch-on asks again', async () => {
    await pool.query("UPDATE users SET sync_consent = 'approved' WHERE id = ?", [user]);
    await adminActivate();
    assert.equal(await consent(), 'approved');
    resetAdminLoginState();
    const login = await request(app).post('/admin/login')
      .send({ phone: ADMIN_PHONE, password: ADMIN_PASSWORD, code: codeAt() });
    const off = await request(app).post(`/admin/users/${user}/status`).set(AUTH(login.body.token))
      .send({ status: 'none', code: codeAt(1) });
    assert.equal(off.status, 200, JSON.stringify(off.body));
    assert.equal(await consent(), 'none');
    await adminActivate();
    assert.equal(await consent(), 'pending');
    assert.equal((await pull()).status, 402);
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
    await adminActivate();
    resetAdminLoginState();
    const login = await request(app).post('/admin/login')
      .send({ phone: ADMIN_PHONE, password: ADMIN_PASSWORD, code: codeAt() });
    const list = await request(app).get('/admin/users').set(AUTH(login.body.token));
    assert.equal(list.body.users[0].sync_consent, 'pending');
  });
});
