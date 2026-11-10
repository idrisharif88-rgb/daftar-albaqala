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
    await pool.query('UPDATE users SET pos_enabled = 1, pos_staff_enabled = 1 WHERE id IN (?, ?)', [ownerA, ownerB]);
    tokenA = tokenFor(ownerA); tokenB = tokenFor(ownerB);
  });

  /** Owner adds a staff member, who logs in. Returns the staff id + token. */
  async function hire(ownerToken: string, role: string, permissions?: string[]) {
    const phone = nextPhone();
    const add = await request(app).post('/pos-staff').set(AUTH(ownerToken))
      .send({ name: `موظف ${role}`, phone, role, password: PASSWORD, ...(permissions ? { permissions } : {}) });
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
    // An owner's number is allowed: staff sign in on their own path.
    assert.equal((await add({ ...good, phone: owner.phone, name: 'صاحب متجر آخر' })).status, 201);
    // …and a staff member may register a book of their own with the same number.
    const reg = await request(app).post('/auth/register').send({ phone: good.phone, password: PASSWORD });
    assert.equal(reg.status, 201);
  });

  test("an owner cannot change another owner's staff", async () => {
    const s = await hire(tokenA, 'cashier');
    const res = await request(app).patch(`/pos-staff/${s.id}`).set(AUTH(tokenB)).send({ role: 'admin' });
    assert.equal(res.status, 404);
    const [[row]] = await pool.query('SELECT role FROM pos_staff WHERE id = ?', [s.id]) as unknown as [[{ role: string }]];
    assert.equal(row.role, 'cashier');
  });

  test('staff without manage_staff cannot manage staff', async () => {
    const cashier = await hire(tokenA, 'cashier');
    assert.equal((await request(app).get('/pos-staff').set(AUTH(cashier.token))).status, 403);
    const add = await request(app).post('/pos-staff').set(AUTH(cashier.token))
      .send({ name: 'x', phone: nextPhone(), role: 'cashier', password: PASSWORD });
    assert.equal(add.status, 403);
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
      ['get', '/me'], ['get', '/customers'], ['get', '/sync/pull'], ['delete', '/account'],
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

  test('disabling or a new password signs the member out at once', async () => {
    for (const change of [{ disabled: true }, { password: 'another-one' }]) {
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

describe('POS staff: developer switch and permissions', () => {
  let owner: string; let token: string;
  let seq = 0;
  const phone = () => `56${String(seq++).padStart(7, '0')}`;

  before(() => {
    assert.equal(process.env.DB_NAME, 'daftar_test');
  });
  beforeEach(async () => {
    await cleanDb();
    owner = await seedUser();
    await pool.query('UPDATE users SET pos_enabled = 1, pos_staff_enabled = 1 WHERE id = ?', [owner]);
    token = tokenFor(owner);
  });

  async function hire(permissions: string[] | undefined, role = 'cashier', by = token) {
    const p = phone();
    const add = await request(app).post('/pos-staff').set(AUTH(by))
      .send({ name: 'م', phone: p, role, password: PASSWORD, ...(permissions ? { permissions } : {}) });
    if (add.status !== 201) return { status: add.status, id: '', token: '' };
    const login = await request(app).post('/auth/staff/login').send({ phone: p, password: PASSWORD });
    return { status: 201, id: add.body.staff.id as string, token: login.body.token as string };
  }

  test('switched off by the developer: no staff screen, no login, no token', async () => {
    const s = await hire(undefined);
    await pool.query('UPDATE users SET pos_staff_enabled = 0 WHERE id = ?', [owner]);
    assert.equal((await request(app).get('/pos-staff').set(AUTH(token))).status, 403);
    assert.equal((await request(app).get('/pos-sync/pull').set(AUTH(s.token))).status, 403);
    const [[row]] = await pool.query('SELECT phone FROM pos_staff WHERE id = ?', [s.id]) as unknown as [[{ phone: string }]];
    const login = await request(app).post('/auth/staff/login').send({ phone: row.phone, password: PASSWORD });
    assert.equal(login.status, 403);
    // the owner's own POS keeps working
    assert.equal((await request(app).get('/pos-sync/pull').set(AUTH(token))).status, 200);
    // and switching it back on restores the member as they were
    await pool.query('UPDATE users SET pos_staff_enabled = 1 WHERE id = ?', [owner]);
    assert.equal((await request(app).get('/pos-sync/pull').set(AUTH(s.token))).status, 200);
  });

  test('/me tells the owner whether the switch is on', async () => {
    const me = await request(app).get('/me').set(AUTH(token));
    assert.equal(me.body.user.pos_staff_enabled, true);
  });

  test('a role is a preset; an explicit list replaces it; unknown codes are refused', async () => {
    const res = await request(app).post('/pos-staff').set(AUTH(token))
      .send({ name: 'x', phone: phone(), role: 'cashier', password: PASSWORD });
    assert.deepEqual(res.body.staff.permissions, ['sell', 'notes']);
    const custom = await request(app).post('/pos-staff').set(AUTH(token))
      .send({ name: 'y', phone: phone(), role: 'cashier', password: PASSWORD, permissions: ['sell', 'see_stock'] });
    assert.deepEqual(custom.body.staff.permissions, ['sell', 'see_stock']);
    const bad = await request(app).post('/pos-staff').set(AUTH(token))
      .send({ name: 'z', phone: phone(), role: 'cashier', password: PASSWORD, permissions: ['sell', 'root'] });
    assert.equal(bad.status, 400);
  });

  test('a permission switched off applies to the very next request', async () => {
    const s = await hire(['sell', 'manage_products']);
    const p = { id: randomUUID(), name: 'خبز', code: EAN(1), price: 100,
      created_at: '2026-11-08T05:00:00Z', updated_at: '2026-11-08T05:00:00Z', deleted_at: null };
    const ok = await request(app).post('/pos-sync/push').set(AUTH(s.token)).send({ products: [p] });
    assert.deepEqual(ok.body.products.accepted, [p.id]);
    await request(app).patch(`/pos-staff/${s.id}`).set(AUTH(token)).send({ permissions: ['sell'] });
    const p2 = { ...p, id: randomUUID(), code: EAN(2), name: 'آخر' };
    const no = await request(app).post('/pos-sync/push').set(AUTH(s.token)).send({ products: [p2] });
    assert.equal(no.status, 200);                               // same token, still signed in…
    assert.equal(no.body.products.rejected[0].reason, 'forbidden'); // …but no longer allowed
  });

  test('/auth/staff/me returns the current permissions', async () => {
    const s = await hire(['sell']);
    await request(app).patch(`/pos-staff/${s.id}`).set(AUTH(token)).send({ permissions: ['sell', 'see_reports'] });
    const me = await request(app).get('/auth/staff/me').set(AUTH(s.token));
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.staff.permissions, ['sell', 'see_reports']);
    assert.equal((await request(app).get('/auth/staff/me').set(AUTH(token))).status, 400); // an owner token
  });

  test('a staff manager can grant only what they hold, cannot touch a stronger member or themselves', async () => {
    const manager = await hire(['manage_staff', 'sell', 'see_stock']);
    // grants within their own set: fine
    const ok = await hire(['sell'], 'cashier', manager.token);
    assert.equal(ok.status, 201);
    // grants beyond it: refused
    assert.equal((await hire(['manage_products'], 'cashier', manager.token)).status, 403);
    assert.equal((await hire(undefined, 'admin', manager.token)).status, 403); // the admin preset holds more
    // cannot raise someone beyond their own set
    const up = await request(app).patch(`/pos-staff/${ok.id}`).set(AUTH(manager.token)).send({ permissions: ['sell', 'submit_day'] });
    assert.equal(up.status, 403);
    // can lower within it
    const down = await request(app).patch(`/pos-staff/${ok.id}`).set(AUTH(manager.token)).send({ disabled: true });
    assert.equal(down.status, 200);
    // cannot touch a member holding more than they do
    const admin = await hire(undefined, 'admin');
    const touch = await request(app).patch(`/pos-staff/${admin.id}`).set(AUTH(manager.token)).send({ disabled: true });
    assert.equal(touch.status, 403);
    // cannot change themselves
    const self = await request(app).patch(`/pos-staff/${manager.id}`).set(AUTH(manager.token)).send({ permissions: ['manage_staff', 'sell', 'see_stock'] });
    assert.equal(self.status, 403);
  });
});

describe('POS notes', () => {
  let owner: string; let token: string;
  let seq = 0;
  const phone = () => `57${String(seq++).padStart(7, '0')}`;
  const aNote = (over: Record<string, unknown> = {}) => ({
    id: randomUUID(), day: '2026-11-10', body: 'نفد الكيس الكبير', created_at: '2026-11-10T08:00:00Z',
    deleted_at: null, ...over,
  });

  beforeEach(async () => {
    await cleanDb();
    owner = await seedUser();
    await pool.query('UPDATE users SET pos_enabled = 1, pos_staff_enabled = 1, pos_notes_enabled = 1 WHERE id = ?', [owner]);
    token = tokenFor(owner);
  });

  async function staffWith(permissions: string[]) {
    const p = phone();
    await request(app).post('/pos-staff').set(AUTH(token))
      .send({ name: 'سالم', phone: p, role: 'cashier', password: PASSWORD, permissions });
    const login = await request(app).post('/auth/staff/login').send({ phone: p, password: PASSWORD });
    return login.body.token as string;
  }
  const push = (t: string, notes: unknown[]) => request(app).post('/pos-sync/push').set(AUTH(t)).send({ notes });
  const pullNotes = async (t: string) => (await request(app).get('/pos-sync/pull').set(AUTH(t))).body.notes as Record<string, unknown>[];

  test('the author is set by the server, not by the phone', async () => {
    const t = await staffWith(['sell', 'notes']);
    const n = aNote({ author_name: 'المالك', author_staff_id: null }); // a forged author
    const res = await push(t, [n]);
    assert.deepEqual(res.body.notes.accepted, [n.id]);
    const [[row]] = await pool.query('SELECT author_name, author_staff_id FROM pos_notes WHERE id = ?', [n.id]) as unknown as [[Record<string, unknown>]];
    assert.equal(row.author_name, 'سالم');
    assert.ok(row.author_staff_id);
    // the owner sees it
    assert.equal((await pullNotes(token)).length, 1);
  });

  test('without the permission, notes neither go up nor come down', async () => {
    await push(token, [aNote()]);
    const t = await staffWith(['sell']);
    const res = await push(t, [aNote()]);
    assert.equal(res.body.notes.rejected[0].reason, 'forbidden');
    assert.deepEqual(await pullNotes(t), []);
  });

  test("a member given `notes` later still receives the notes written before", async () => {
    await push(token, [aNote({ body: 'قديمة' })]);
    const t = await staffWith(['sell']);
    const first = await request(app).get('/pos-sync/pull').set(AUTH(t));
    assert.deepEqual(first.body.notes, []);
    const [[s]] = await pool.query("SELECT id FROM pos_staff WHERE owner_id = ?", [owner]) as unknown as [[{ id: string }]];
    await request(app).patch(`/pos-staff/${s.id}`).set(AUTH(token)).send({ permissions: ['sell', 'notes'] });
    const next = await request(app).get('/pos-sync/pull').query({ since: first.body.synced_at }).set(AUTH(t));
    assert.equal(next.body.notes.length, 1);
    assert.equal(next.body.notes[0].body, 'قديمة');
  });

  test('switched off by the developer: no notes for anyone, owner included', async () => {
    await pool.query('UPDATE users SET pos_notes_enabled = 0 WHERE id = ?', [owner]);
    const res = await push(token, [aNote()]);
    assert.equal(res.body.notes.rejected[0].reason, 'forbidden');
    assert.deepEqual(await pullNotes(token), []);
  });

  test('the author edits and deletes their own note; the owner any; another member none', async () => {
    const t = await staffWith(['sell', 'notes']);
    const n = aNote();
    await push(t, [n]);
    // the author edits (last edit wins on edited_at)
    const edit = await push(t, [{ ...n, body: 'نفد الكيس الصغير', edited_at: '2026-11-10T09:00:00Z' }]);
    assert.deepEqual(edit.body.notes.accepted, [n.id]);
    // an older edit does not win
    await push(t, [{ ...n, body: 'قديم', edited_at: '2026-11-10T08:00:00Z' }]);
    let [[row]] = await pool.query('SELECT body, edited_at, deleted_at FROM pos_notes WHERE id = ?', [n.id]) as unknown as [[Record<string, unknown>]];
    assert.equal(row.body, 'نفد الكيس الصغير');
    assert.ok(row.edited_at);
    // the owner edits it too
    await push(token, [{ ...n, body: 'تعديل المالك', edited_at: '2026-11-10T10:00:00Z' }]);
    [[row]] = await pool.query('SELECT body FROM pos_notes WHERE id = ?', [n.id]) as unknown as [[Record<string, unknown>]];
    assert.equal(row.body, 'تعديل المالك');
    // the author deletes it
    const del = await push(t, [{ ...n, body: 'تعديل المالك', deleted_at: '2026-11-10T11:00:00Z' }]);
    assert.deepEqual(del.body.notes.accepted, [n.id]);
    [[row]] = await pool.query('SELECT deleted_at FROM pos_notes WHERE id = ?', [n.id]) as unknown as [[Record<string, unknown>]];
    assert.ok(row.deleted_at);
  });

  test("another member cannot edit or delete someone else's note", async () => {
    const owner2Note = aNote();
    await push(token, [owner2Note]); // the owner's note
    const t = await staffWith(['sell', 'notes']);
    const edit = await push(t, [{ ...owner2Note, body: 'محاولة', edited_at: '2026-11-10T09:00:00Z' }]);
    assert.equal(edit.body.notes.rejected[0].reason, 'forbidden');
    const del = await push(t, [{ ...owner2Note, deleted_at: '2026-11-10T09:00:00Z' }]);
    assert.equal(del.body.notes.rejected[0].reason, 'forbidden');
    const [[row]] = await pool.query('SELECT body, deleted_at FROM pos_notes WHERE id = ?', [owner2Note.id]) as unknown as [[Record<string, unknown>]];
    assert.equal(row.body, 'نفد الكيس الكبير');
    assert.equal(row.deleted_at, null);
  });

  test('invalid notes are refused; another shop never sees them', async () => {
    const res = await push(token, [aNote({ body: '   ' }), aNote({ body: 'x'.repeat(1001) }), aNote({ day: 'today' })]);
    assert.equal(res.body.notes.rejected.length, 3);
    await push(token, [aNote()]);
    const other = await seedUser();
    await pool.query('UPDATE users SET pos_enabled = 1, pos_notes_enabled = 1 WHERE id = ?', [other]);
    assert.deepEqual(await pullNotes(tokenFor(other)), []);
  });

  test('an older p1 cursor still works, and its notes start from zero', async () => {
    await push(token, [aNote()]);
    const p1 = ['p1', ...Array(4).fill(['2026-11-10T23:00:00.000Z', ''])].flat().join('|');
    const res = await request(app).get('/pos-sync/pull').query({ since: p1 }).set(AUTH(token));
    assert.equal(res.status, 200);
    assert.equal(res.body.notes.length, 1);
    assert.ok(String(res.body.synced_at).startsWith('p2|'));
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

// One pool for the whole file: ending it in the first suite would break the next.
after(async () => { await pool.end(); });
