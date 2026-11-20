import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor } from './helpers';
import { base32Decode, base32Encode, currentStep, totpAt } from '../admin/totp';
import { resetAdminLoginState } from '../routes/admin';

// A shop's own logo (024): set by the Watcher, fetched by that shop's app only.

const AUTH = (t: string) => ({ Authorization: `Bearer ${t}` });
const ADMIN_PHONE = '777000444';
const ADMIN_PASSWORD = 'logo test password';
const TOTP_SECRET = base32Encode(Buffer.from('logo-secret-12345678'));
const codeAt = (offset = 0) => totpAt(base32Decode(TOTP_SECRET), currentStep() + offset);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('brand logo', () => {
  let user: string; let other: string;

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
    user = await seedUser();
    other = await seedUser();
  });
  after(async () => { await pool.end(); });

  async function adminToken(): Promise<string> {
    resetAdminLoginState();
    const login = await request(app).post('/admin/login')
      .send({ phone: ADMIN_PHONE, password: ADMIN_PASSWORD, code: codeAt() });
    return login.body.token;
  }
  const setLogo = async (logo: unknown, id = user) =>
    request(app).post(`/admin/users/${id}/logo`).set(AUTH(await adminToken())).send({ logo, code: codeAt(1) });

  test('set → /me says when → only that shop gets it → remove', async () => {
    assert.equal((await setLogo(PNG)).status, 200);
    const me = await request(app).get('/me').set(AUTH(tokenFor(user)));
    assert.ok(me.body.user.brand_logo_at);
    const mine = await request(app).get('/account/logo').set(AUTH(tokenFor(user)));
    assert.equal(mine.body.logo, PNG);
    const theirs = await request(app).get('/account/logo').set(AUTH(tokenFor(other)));
    assert.equal(theirs.body.logo, null);                       // tenant isolation

    const list = await request(app).get('/admin/users').set(AUTH(await adminToken()));
    assert.equal(list.body.users.find((u: { id: string }) => u.id === user).has_logo, true);

    assert.equal((await setLogo(null)).status, 200);
    const gone = await request(app).get('/me').set(AUTH(tokenFor(user)));
    assert.equal(gone.body.user.brand_logo_at, null);
  });

  test('refuses anything that is not a small image data URL', async () => {
    assert.equal((await setLogo('https://example.com/a.png')).status, 400);
    assert.equal((await setLogo('data:text/html;base64,PGgxPg==')).status, 400);
    assert.equal((await setLogo('data:image/png;base64,' + 'A'.repeat(300_001))).status, 400);
  });

  test('needs a valid authenticator code', async () => {
    const res = await request(app).post(`/admin/users/${user}/logo`).set(AUTH(await adminToken()))
      .send({ logo: PNG, code: '000000' });
    assert.equal(res.status, 403);
  });
});
