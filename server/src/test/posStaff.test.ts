import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app from '../app';
import { pool } from '../db';
import { cleanDb, seedUser, tokenFor } from './helpers';
import { createLoginThrottle } from '../auth/loginThrottle';

// POS staff: the owner adds a cashier / adder / admin; each logs in with their
// own phone and works on the OWNER's point-of-sale data, limited by role. The
// server is the enforcement point — these tests push what a tampered app could.

const AUTH = (t: string) => ({ Authorization: `Bearer ${t}` });
const EAN = (n: number) => `2${String(n).padStart(11, '0')}0`;
const PASSWORD = 'secret123';

const aProduct = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(), name: 'خبز', code: EAN(1), price: 5000,
  created_at: '2026-11-08T05:00:00Z', updated_at: '2026-11-08T05:00:00Z', deleted_at: null, ...over,
});
const aSale = (productId: string) => ({
  id: randomUUID(), product_id: productId, day: '2026-11-08', qty: 1, price: 5000, created_at: '2026-11-08T06:00:00Z',
});
const aBake = (productId: string) => ({
  id: randomUUID(), product_id: productId, day: '2026-11-08', qty: 40, created_at: '2026-11-08T05:30:00Z',
});
const aLock = () => ({ day: '2026-11-08', locked_at: '2026-11-08T07:00:00Z', reopened: 0, updated_at: '2026-11-08T07:00:00Z' });

describe('POS staff', () => {
  let ownerA: string; let ownerB: string; let tokenA: string; let tokenB: string;
  let phoneSeq = 0;
  const nextPhone = () => `55${String(phoneSeq++).padStart(7, '0')}`;

  before(() => {
    assert.equal(process.env.DB_NAME, 'daftar_test',
      'refusing to run: DB_NAME must be daftar_test, got ' + process.env.DB_NAME);
  });
  beforeEach(async () => {
    await cleanDb();
    ownerA = await seedUser(); ownerB = await seedUser();
    await pool.query('UPDATE users SET pos_enabled = 1 WHERE id IN (?, ?)', [ownerA, ownerB]);
    tokenA = tokenFor(ownerA); tokenB = tokenFor(ownerB);
  });
  after(async () => { await pool.end(); });

  /** Owner adds a staff member, who logs in. Returns the staff id + token. */
  async function hire(ownerToken: string, role: string) {
    const phone = nextPhone();
    const add = await request(app).post('/pos-staff').set(AUTH(ownerToken))
      .send({ name: `موظف ${role}`, phone, role, password: PASSWORD });
    assert.equal(add.status, 201, JSON.stringify(add.body));
    const login = await request(app).post('/auth/staff/login').send({ phone, password: PASSWORD });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    return { id: add.body.staff.id as string, token: login.body.token as string, phone };
  }
  const push = (token: string, body: Record<string, unknown>) =>
    request(app).post('/pos-sync/push').set(AUTH(token)).send(body);

  // ---------------------------------------------------------------- managing staff

  test('owner adds and lists staff; the hash never leaves the server', async () => {
    const s = await hire(tokenA, 'cashier');
    const list = await request(app).get('/pos-staff').set(AUTH(tokenA));
    assert.equal(list.status, 200);
    assert.equal(list.body.staff.length, 1);
    assert.equal(list.body.staff[0].id, s.id);
    assert.equal(list.body.staff[0].role, 'cashier');
    assert.ok(!JSON.stringify(list.body).includes('password'));
    // another owner sees none of them
    assert.equal((await request(app).get('/pos-staff').set(AUTH(tokenB))).body.staff.length, 0);
  });

  test('input is validated, and a number already in use is refused', async () => {
    const add = (body: Record<string, unknown>) => request(app).post('/pos-staff').set(AUTH(tokenA)).send(body);
    const good = { name: 'علي', phone: nextPhone(), role: 'cashier', password: PASSWORD };
    assert.equal((await add({ ...good, name: '  ' })).status, 400);
    assert.equal((await add({ ...good, phone: '12' })).status, 400);
    assert.equal((await add({ ...good, role: 'owner' })).status, 400);
    assert.equal((await add({ ...good, password: '123' })).status, 400);
    assert.equal((await add(good)).status, 201);
    assert.equal((await add({ ...good, name: 'آخر' })).status, 409);           // a staff number
    const [[owner]] = await pool.query('SELECT phone FROM users WHERE id = ?', [ownerB]) as unknown as [[{ phone: string }]];
    assert.equal((await add({ ...good, phone: owner.phone })).status, 409);    // an owner's number
    // and an owner cannot register with a staff member's number
    const reg = await request(app).post('/auth/register').send({ phone: good.phone, password: PASSWORD });
    assert.equal(reg.status, 409);
  });

  test("an owner cannot change another owner's staff", async () => {
    const s = await hire(tokenA, 'cashier');
    const res = await request(app).patch(`/pos-staff/${s.id}`).set(AUTH(tokenB)).send({ role: 'admin' });
    assert.equal(res.status, 404);
    const [[row]] = await pool.query('SELECT role FROM pos_staff WHERE id = ?', [s.id]) as unknown as [[{ role: string }]];
    assert.equal(row.role, 'cashier');
  });

  test('staff cannot manage staff', async () => {
    const admin = await hire(tokenA, 'admin');
    assert.equal((await request(app).get('/pos-staff').set(AUTH(admin.token))).status, 401);
    const add = await request(app).post('/pos-staff').set(AUTH(admin.token))
      .send({ name: 'x', phone: nextPhone(), role: 'admin', password: PASSWORD });
    assert.equal(add.status, 401);
  });

  // ---------------------------------------------------------------- login + token scope

  test('login: same answer for a wrong number and a wrong password', async () => {
    const s = await hire(tokenA, 'cashier');
    const wrongPw = await request(app).post('/auth/staff/login').send({ phone: s.phone, password: 'nope-nope' });
    const wrongPhone = await request(app).post('/auth/staff/login').send({ phone: nextPhone(), password: PASSWORD });
    assert.equal(wrongPw.status, 401);
    assert.equal(wrongPhone.status, 401);
    assert.deepEqual(wrongPw.body, wrongPhone.body);
  });

  test('a staff token opens /pos-sync and nothing else', async () => {
    const s = await hire(tokenA, 'admin');
    for (const [method, path] of [
      ['get', '/me'], ['get', '/customers'], ['get', '/sync/pull'], ['delete', '/account'], ['get', '/pos-staff'],
    ] as const) {
      const res = await request(app)[method](path).set(AUTH(s.token));
      assert.equal(res.status, 401, `${method} ${path} should refuse a staff token`);
    }
    assert.equal((await request(app).get('/pos-sync/pull').set(AUTH(s.token))).status, 200);
  });

  test('an owner login does not accept a staff number', async () => {
    const s = await hire(tokenA, 'cashier');
    const res = await request(app).post('/auth/login').send({ phone: s.phone, password: PASSWORD });
    assert.equal(res.status, 401);
  });

  // ---------------------------------------------------------------- roles at /pos-sync

  test("cashier: sells, and nothing else — rows land in the OWNER's data", async () => {
    const p = aProduct();
    await push(tokenA, { products: [p] });
    const s = await hire(tokenA, 'cashier');
    const sale = aSale(p.id); const bake = aBake(p.id); const p2 = aProduct({ code: EAN(2), name: 'جديد' });
    const res = await push(s.token, { products: [p2], baked: [bake], sales: [sale], day_locks: [aLock()] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.sales.accepted, [sale.id]);
    assert.deepEqual(res.body.products.rejected, [{ id: p2.id, reason: 'forbidden' }]);
    assert.deepEqual(res.body.baked.rejected, [{ id: bake.id, reason: 'forbidden' }]);
    assert.deepEqual(res.body.day_locks.rejected, [{ id: '2026-11-08', reason: 'forbidden' }]);
    const [[row]] = await pool.query('SELECT user_id FROM pos_sales WHERE id = ?', [sale.id]) as unknown as [[{ user_id: string }]];
    assert.equal(row.user_id, ownerA);
    const [prods] = await pool.query('SELECT id FROM pos_products WHERE id = ?', [p2.id]);
    assert.equal((prods as unknown[]).length, 0);
  });

  test('cashier cannot change a price', async () => {
    const p = aProduct();
    await push(tokenA, { products: [p] });
    const s = await hire(tokenA, 'cashier');
    await push(s.token, { products: [{ ...p, price: 1, updated_at: '2026-11-09T00:00:00Z' }] });
    const [[row]] = await pool.query('SELECT price FROM pos_products WHERE id = ?', [p.id]) as unknown as [[{ price: number }]];
    assert.equal(Number(row.price), 5000);
  });

  test('adder: enters quantities; cannot add products, change prices or sell', async () => {
    const p = aProduct();
    await push(tokenA, { products: [p] });
    const s = await hire(tokenA, 'adder');
    const bake = aBake(p.id); const sale = aSale(p.id);
    const res = await push(s.token, {
      products: [{ ...p, price: 1, updated_at: '2026-11-09T00:00:00Z' }], baked: [bake], sales: [sale],
    });
    assert.deepEqual(res.body.baked.accepted, [bake.id]);
    assert.equal(res.body.products.rejected[0].reason, 'forbidden');
    assert.equal(res.body.sales.rejected[0].reason, 'forbidden');
  });

  test('admin: everything the owner can do at the point of sale', async () => {
    const s = await hire(tokenA, 'admin');
    const p = aProduct();
    const res = await push(s.token, { products: [p], baked: [aBake(p.id)], sales: [aSale(p.id)], day_locks: [aLock()] });
    assert.equal(res.body.products.accepted.length, 1);
    assert.equal(res.body.baked.accepted.length, 1);
    assert.equal(res.body.sales.accepted.length, 1);
    assert.equal(res.body.day_locks.accepted.length, 1);
  });

  test("staff pull the owner's data, never another shop's", async () => {
    const mine = aProduct(); const theirs = aProduct({ code: EAN(3) });
    await push(tokenA, { products: [mine] });
    await push(tokenB, { products: [theirs] });
    const s = await hire(tokenA, 'cashier');
    const pull = await request(app).get('/pos-sync/pull').set(AUTH(s.token));
    const ids = (pull.body.products as { id: string }[]).map((x) => x.id);
    assert.deepEqual(ids, [mine.id]);
  });

  test("a staff member cannot touch another shop's product id", async () => {
    const theirs = aProduct();
    await push(tokenB, { products: [theirs] });
    const s = await hire(tokenA, 'admin');
    const res = await push(s.token, { sales: [aSale(theirs.id)], products: [{ ...theirs, name: 'x', updated_at: '2026-12-01T00:00:00Z' }] });
    assert.equal(res.body.sales.rejected[0].reason, 'missing_product');
    assert.equal(res.body.products.rejected[0].reason, 'foreign_owner');
  });

  // ---------------------------------------------------------------- revocation

  test('disabling, a new password or a new role signs the member out at once', async () => {
    for (const change of [{ disabled: true }, { password: 'another-one' }, { role: 'adder' }]) {
      const s = await hire(tokenA, 'cashier');
      assert.equal((await request(app).get('/pos-sync/pull').set(AUTH(s.token))).status, 200);
      const patch = await request(app).patch(`/pos-staff/${s.id}`).set(AUTH(tokenA)).send(change);
      assert.equal(patch.status, 200);
      assert.equal((await request(app).get('/pos-sync/pull').set(AUTH(s.token))).status, 401, JSON.stringify(change));
    }
  });

  test('a disabled member cannot log in; re-enabling lets them back', async () => {
    const s = await hire(tokenA, 'cashier');
    await request(app).patch(`/pos-staff/${s.id}`).set(AUTH(tokenA)).send({ disabled: true });
    assert.equal((await request(app).post('/auth/staff/login').send({ phone: s.phone, password: PASSWORD })).status, 403);
    await request(app).patch(`/pos-staff/${s.id}`).set(AUTH(tokenA)).send({ disabled: false });
    assert.equal((await request(app).post('/auth/staff/login').send({ phone: s.phone, password: PASSWORD })).status, 200);
  });

  test("the owner's gates apply to his staff: suspended, POS off, sync off", async () => {
    const s = await hire(tokenA, 'cashier');
    await pool.query("UPDATE users SET subscription_status = 'suspended' WHERE id = ?", [ownerA]);
    assert.equal((await request(app).get('/pos-sync/pull').set(AUTH(s.token))).status, 403);
    await pool.query("UPDATE users SET subscription_status = 'none' WHERE id = ?", [ownerA]);
    assert.equal((await request(app).get('/pos-sync/pull').set(AUTH(s.token))).status, 402);
    await pool.query("UPDATE users SET subscription_status = 'active', pos_enabled = 0 WHERE id = ?", [ownerA]);
    assert.equal((await request(app).get('/pos-sync/pull').set(AUTH(s.token))).status, 403);
  });

  test('deleting the owner account removes his staff and POS data', async () => {
    const p = aProduct();
    await push(tokenA, { products: [p], sales: [aSale(p.id)] });
    await hire(tokenA, 'cashier');
    assert.equal((await request(app).delete('/account').set(AUTH(tokenA))).status, 200);
    const [staff] = await pool.query('SELECT 1 FROM pos_staff WHERE owner_id = ?', [ownerA]);
    assert.equal((staff as unknown[]).length, 0);
  });
});

describe('login throttle', () => {
  test('locks a phone after 10 failures, frees it after the window, and a success clears it', () => {
    let now = 0;
    const t = createLoginThrottle(() => now);
    for (let i = 0; i < 10; i++) t.fail('777');
    assert.equal(t.blocked('777'), true);
    assert.equal(t.blocked('888'), false);   // per phone
    now += 15 * 60 * 1000;
    assert.equal(t.blocked('777'), false);   // window passed
    for (let i = 0; i < 9; i++) t.fail('999');
    t.succeed('999');
    t.fail('999');
    assert.equal(t.blocked('999'), false);
  });
});
