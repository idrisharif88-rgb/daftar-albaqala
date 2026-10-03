import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor } from './helpers';
import { resetAdminLoginState } from '../routes/admin';
import { base32Encode, base32Decode, currentStep, totpAt, verifyTotp } from '../admin/totp';

// The Watcher app's admin API: the one place that reads across tenants, so the
// tests below are mostly about who CANNOT get in.

const ADMIN_PHONE = '777000111';
const ADMIN_PASSWORD = 'correct horse battery';
const TOTP_SECRET = base32Encode(Buffer.from('12345678901234567890'));

function codeNow(offsetSteps = 0): string {
  return totpAt(base32Decode(TOTP_SECRET), currentStep() + offsetSteps);
}

async function adminToken(): Promise<string> {
  const res = await request(app)
    .post('/admin/login')
    .send({ phone: ADMIN_PHONE, password: ADMIN_PASSWORD, code: codeNow() });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

describe('TOTP', () => {
  test('matches the RFC 6238 SHA-1 vector (T=59 → 287082)', () => {
    assert.equal(totpAt(Buffer.from('12345678901234567890'), 1), '287082');
  });
  test('accepts one step of clock drift, not two', () => {
    const s = currentStep();
    const secret = base32Decode(TOTP_SECRET);
    assert.equal(verifyTotp(TOTP_SECRET, totpAt(secret, s - 1)), s - 1);
    assert.equal(verifyTotp(TOTP_SECRET, totpAt(secret, s + 3)), null);
  });
});

describe('/admin', () => {
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
  });

  after(async () => {
    await pool.end();
  });

  test('phone + password + code → token', async () => {
    assert.ok(await adminToken());
  });

  test('wrong password, wrong phone, wrong code are all refused alike', async () => {
    for (const body of [
      { phone: ADMIN_PHONE, password: 'nope', code: codeNow() },
      { phone: '700000000', password: ADMIN_PASSWORD, code: codeNow() },
      { phone: ADMIN_PHONE, password: ADMIN_PASSWORD, code: '000000' },
      { phone: ADMIN_PHONE, password: ADMIN_PASSWORD },
    ]) {
      const res = await request(app).post('/admin/login').send(body);
      assert.equal(res.status, 401);
      assert.equal(res.body.error, 'invalid credentials');
    }
  });

  test('a code cannot be used twice', async () => {
    await adminToken();
    const res = await request(app)
      .post('/admin/login')
      .send({ phone: ADMIN_PHONE, password: ADMIN_PASSWORD, code: codeNow() });
    assert.equal(res.status, 401);
  });

  test('locks after 10 failures — even the right credentials', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app).post('/admin/login').send({ phone: ADMIN_PHONE, password: 'x', code: '1' });
    }
    const res = await request(app)
      .post('/admin/login')
      .send({ phone: ADMIN_PHONE, password: ADMIN_PASSWORD, code: codeNow() });
    assert.equal(res.status, 429);
  });

  test('closed (503) when the server has no admin configured', async () => {
    const saved = process.env.ADMIN_TOTP_SECRET;
    delete process.env.ADMIN_TOTP_SECRET;
    try {
      const res = await request(app)
        .post('/admin/login')
        .send({ phone: ADMIN_PHONE, password: ADMIN_PASSWORD, code: codeNow() });
      assert.equal(res.status, 503);
    } finally {
      process.env.ADMIN_TOTP_SECRET = saved;
    }
  });

  test('a SHOPKEEPER token cannot open /admin', async () => {
    const user = await seedUser();
    const res = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    assert.equal(res.status, 401);
  });

  test('an ADMIN token cannot pass as a shopkeeper', async () => {
    const token = await adminToken();
    const res = await request(app).get('/me').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 401);
  });

  test('lists every account with counts', async () => {
    await seedUser({ status: 'none' });
    await seedUser({ status: 'active' });
    const token = await adminToken();
    const res = await request(app).get('/admin/users').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.users.length, 2);
    assert.equal(typeof res.body.users[0].customers_count, 'number');
  });

  test('activate, then suspend: suspended cannot log in or sync', async () => {
    const user = await seedUser({ status: 'none' });
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [
      await bcrypt.hash('pw123456', 4),
      user,
    ]);
    const [[row]] = (await pool.query('SELECT phone FROM users WHERE id = ?', [user])) as unknown as [
      Array<{ phone: string }>,
    ];
    const token = await adminToken();

    let res = await request(app)
      .post(`/admin/users/${user}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' });
    assert.equal(res.status, 200);
    res = await request(app).get('/sync/pull').set('Authorization', `Bearer ${tokenFor(user)}`);
    assert.equal(res.status, 200);

    res = await request(app)
      .post(`/admin/users/${user}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'suspended' });
    assert.equal(res.status, 200);

    res = await request(app).get('/sync/pull').set('Authorization', `Bearer ${tokenFor(user)}`);
    assert.equal(res.status, 402);
    assert.equal(res.body.subscription_status, 'suspended');
    res = await request(app).get('/customers').set('Authorization', `Bearer ${tokenFor(user)}`);
    assert.equal(res.status, 403);
    res = await request(app).post('/auth/login').send({ phone: row.phone, password: 'pw123456' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'account suspended');
  });

  test('refuses a status the owner does not hand out, and an unknown id', async () => {
    const user = await seedUser();
    const token = await adminToken();
    let res = await request(app)
      .post(`/admin/users/${user}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'expired' });
    assert.equal(res.status, 400);
    res = await request(app)
      .post('/admin/users/00000000-0000-0000-0000-000000000000/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' });
    assert.equal(res.status, 404);
  });
});
