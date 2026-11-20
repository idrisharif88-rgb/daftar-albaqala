import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor } from './helpers';
import { base32Decode, base32Encode, currentStep, totpAt } from '../admin/totp';
import { resetAdminLoginState } from '../routes/admin';
import { generateCode, MAX_ATTEMPTS } from '../account/phoneVerification';

// Phone verification (022): the Watcher issues a code, the user types it, and
// sync cannot be switched on before that.

const AUTH = (t: string) => ({ Authorization: `Bearer ${t}` });
const ADMIN_PHONE = '777000333';
const ADMIN_PASSWORD = 'verification test password';
const TOTP_SECRET = base32Encode(Buffer.from('zyxwvutsrq9876543210'));
const codeAt = (offset = 0) => totpAt(base32Decode(TOTP_SECRET), currentStep() + offset);

describe('phone verification', () => {
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
    await pool.query('UPDATE users SET phone_verified_at = NULL WHERE id = ?', [user]);
    token = tokenFor(user);
  });
  after(async () => { await pool.end(); });

  async function adminToken(): Promise<string> {
    resetAdminLoginState();
    const login = await request(app).post('/admin/login')
      .send({ phone: ADMIN_PHONE, password: ADMIN_PASSWORD, code: codeAt() });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    return login.body.token;
  }
  const issue = async () =>
    request(app).post(`/admin/users/${user}/verification-code`).set(AUTH(await adminToken()));
  const verify = (code: string) =>
    request(app).post('/account/verify-phone').set(AUTH(token)).send({ code });
  const me = () => request(app).get('/me').set(AUTH(token));

  test('codes are 6 digits', () => {
    for (let i = 0; i < 200; i++) assert.match(generateCode(), /^\d{6}$/);
  });

  test('a new registration is unverified; /me says so', async () => {
    const reg = await request(app).post('/auth/register').send({ phone: '799123456', password: 'secret12' });
    assert.equal(reg.status, 201);
    const res = await request(app).get('/me').set(AUTH(reg.body.token));
    assert.equal(res.body.user.phone_verified, false);
    assert.equal(res.body.user.subscription_status, 'none');
  });

  test('the issued code verifies the number once; only its hash is stored', async () => {
    const issued = await issue();
    assert.equal(issued.status, 200);
    assert.match(issued.body.code, /^\d{6}$/);
    const [rows] = await pool.query('SELECT verify_code_hash FROM users WHERE id = ?', [user]);
    assert.notEqual((rows as Array<{ verify_code_hash: string }>)[0].verify_code_hash, issued.body.code);

    assert.equal((await me()).body.user.phone_verified, false);
    const ok = await verify(issued.body.code);
    assert.equal(ok.status, 200);
    assert.equal((await me()).body.user.phone_verified, true);
    assert.equal((await verify(issued.body.code)).status, 409); // already verified
  });

  test('wrong codes count down, then the code is spent', async () => {
    const issued = await issue();
    const wrong = issued.body.code === '000000' ? '111111' : '000000';
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      const r = await verify(wrong);
      assert.equal(r.status, 400);
      assert.equal(r.body.attempts_left, MAX_ATTEMPTS - i);
    }
    assert.equal((await verify(wrong)).status, 410);
    assert.equal((await verify(issued.body.code)).status, 410); // even the right one now
    const fresh = await issue();                                  // a new code starts over
    assert.equal((await verify(fresh.body.code)).status, 200);
  });

  test('an expired code is refused; a new code replaces the old one', async () => {
    const first = await issue();
    const second = await issue();
    if (first.body.code !== second.body.code) assert.equal((await verify(first.body.code)).status, 400);
    await pool.query('UPDATE users SET verify_code_expires_at = ? WHERE id = ?', [new Date(Date.now() - 60_000), user]);
    assert.equal((await verify(second.body.code)).status, 410);
  });

  test('no code issued → 404', async () => {
    assert.equal((await verify('123456')).status, 404);
  });

  const activate = async (active: boolean) =>
    request(app).post(`/admin/users/${user}/activation`).set(AUTH(await adminToken()))
      .send({ active, code: codeAt(1) });
  const syncOn = async (extra: Record<string, unknown> = {}) =>
    request(app).post(`/admin/users/${user}/status`).set(AUTH(await adminToken()))
      .send({ status: 'active', code: codeAt(1), ...extra });
  const activatedAt = async () =>
    ((await pool.query('SELECT activated_at FROM users WHERE id = ?', [user]))[0] as Array<{ activated_at: Date | null }>)[0].activated_at;

  test('verify → activate → sync: each step refused until the one before it', async () => {
    await pool.query("UPDATE users SET sync_consent = 'approved', activated_at = NULL WHERE id = ?", [user]);
    const notVerified = await syncOn();
    assert.equal(notVerified.status, 409);
    assert.equal(notVerified.body.error, 'phone not verified');
    assert.equal((await activate(true)).status, 409);          // activation needs a verified number

    const issued = await issue();
    assert.equal((await verify(issued.body.code)).status, 200);
    const notActivated = await syncOn();
    assert.equal(notActivated.status, 409);
    assert.equal(notActivated.body.error, 'account not activated');

    assert.equal((await activate(true)).status, 200);
    assert.equal((await me()).body.user.activated, true);
    const ok = await syncOn();
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  test('deactivating switches server sync off too', async () => {
    await pool.query(
      "UPDATE users SET phone_verified_at = UTC_TIMESTAMP(), activated_at = UTC_TIMESTAMP(), subscription_status = 'active', sync_consent = 'approved' WHERE id = ?",
      [user],
    );
    assert.equal((await activate(false)).status, 200);
    const [rows] = await pool.query('SELECT subscription_status, sync_consent FROM users WHERE id = ?', [user]);
    assert.deepEqual({ ...(rows as Array<Record<string, unknown>>)[0] }, { subscription_status: 'none', sync_consent: 'none' });
    assert.equal(await activatedAt(), null);
  });

  test('direct sync-on still works for an unverified, unactivated account and activates it', async () => {
    await pool.query('UPDATE users SET activated_at = NULL WHERE id = ?', [user]);
    assert.equal((await syncOn({ direct: true })).status, 200);
    assert.notEqual(await activatedAt(), null);
  });

  test('a new registration is not activated', async () => {
    const reg = await request(app).post('/auth/register').send({ phone: '799123457', password: 'secret12' });
    const res = await request(app).get('/me').set(AUTH(reg.body.token));
    assert.equal(res.body.user.activated, false);
  });

  test('the Watcher list carries phone_verified', async () => {
    const res = await request(app).get('/admin/users').set(AUTH(await adminToken()));
    const row = res.body.users.find((u: { id: string }) => u.id === user);
    assert.equal(row.phone_verified, false);
    assert.equal(row.activated, true); // seeded = an account from before 023
  });
});
