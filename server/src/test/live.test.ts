import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor } from './helpers';
import { base32Decode, base32Encode, currentStep, totpAt } from '../admin/totp';
import { resetAdminLoginState } from '../routes/admin';
import { issueTicket, redeemTicket } from '../live/hub';

// The live line: a sync request reaches the user's open app at once, and the
// answer reaches the Watcher at once.

const AUTH = (t: string) => ({ Authorization: `Bearer ${t}` });
const ADMIN_PHONE = '777000444';
const ADMIN_PASSWORD = 'live test password';
const TOTP_SECRET = base32Encode(Buffer.from('live0123456789abcdef'));
const codeAt = (o = 0) => totpAt(base32Decode(TOTP_SECRET), currentStep() + o);

/** Open GET /events and resolve with the first event named `name`. */
function firstEvent(base: string, ticket: string, name: string): Promise<{ data: Record<string, unknown>; close: () => void }> {
  const ctl = new AbortController();
  return new Promise((resolve, reject) => {
    fetch(`${base}/events?ticket=${ticket}`, { signal: ctl.signal }).then(async (res) => {
      if (res.status !== 200) { reject(new Error(`status ${res.status}`)); return; }
      const reader = res.body!.getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += Buffer.from(value).toString();
        const m = buf.match(new RegExp(`event: ${name}\\ndata: (.*)\\n\\n`));
        if (m) { resolve({ data: JSON.parse(m[1]), close: () => ctl.abort() }); return; }
      }
    }).catch((e) => { if (e.name !== 'AbortError') reject(e); });
  });
}

describe('live events', () => {
  let server: Server; let base = ''; let user: string; let token: string;
  before(async () => {
    assert.equal(process.env.DB_NAME, 'daftar_test');
    process.env.ADMIN_PHONE = ADMIN_PHONE;
    process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash(ADMIN_PASSWORD, 4);
    process.env.ADMIN_TOTP_SECRET = TOTP_SECRET;
    process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'x'.repeat(40);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(async () => {
    await cleanDb();
    resetAdminLoginState();
    user = await seedUser({ status: 'none' });
    token = tokenFor(user);
  });
  after(async () => { server.close(); await pool.end(); });

  const adminToken = async () => {
    resetAdminLoginState();
    const r = await request(app).post('/admin/login').send({ phone: ADMIN_PHONE, password: ADMIN_PASSWORD, code: codeAt() });
    return r.body.token as string;
  };

  test('a ticket is single-use and short-lived', () => {
    const t = issueTicket('user:x', 1000);
    assert.equal(redeemTicket(t, 1000), 'user:x');
    assert.equal(redeemTicket(t, 1000), null);
    assert.equal(redeemTicket(issueTicket('user:x', 1000), 1000 + 31_000), null);
  });

  test('an unknown ticket is refused', async () => {
    assert.equal((await fetch(`${base}/events?ticket=nope`)).status, 401);
  });

  test('the sync request reaches the user at once; the answer reaches the Watcher at once', async () => {
    const userTicket = (await request(app).post('/events/ticket').set(AUTH(token))).body.ticket as string;
    const gotRequest = firstEvent(base, userTicket, 'sync-request');
    const admin = await adminToken();
    const adminTicket = (await request(app).post('/admin/events/ticket').set(AUTH(admin))).body.ticket as string;
    const gotAnswer = firstEvent(base, adminTicket, 'consent');
    await new Promise((r) => setTimeout(r, 100)); // both streams open

    await request(app).post(`/admin/users/${user}/sync-request`).set(AUTH(admin));
    const req = await gotRequest;
    assert.equal(req.data.sync_consent, 'pending');
    req.close();

    await request(app).post('/account/sync-consent').set(AUTH(token)).send({ approve: true });
    const ans = await gotAnswer;
    assert.deepEqual(ans.data, { id: user, sync_consent: 'approved' });
    ans.close();
  });

  test('a ticket needs a token; the admin ticket needs an admin token', async () => {
    assert.equal((await request(app).post('/events/ticket')).status, 401);
    assert.equal((await request(app).post('/admin/events/ticket').set(AUTH(token))).status, 401);
  });
});
