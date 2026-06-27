# daftar-albaqala — Project Guide (read me first)

> Handoff doc. Claude Code auto-loads this. Keep it updated as the project evolves.

## What this is
An **offline-first, multi-tenant mobile app** for grocery store owners (دفتر البقالة) to
track customer **debts and payments**. Each shopkeeper records customers and debt/payment
transactions; the app shows running balances. Works fully offline on the phone, syncs to the
owner's cloud server.

## Architecture & key decisions (already settled — don't relitigate)
- **Monorepo:** `src/` = the Ionic/React/Capacitor app (runs on phones). `server/` = the
  Express/TypeScript backend (runs on the droplet). One git repo holds both.
- **Offline-first:** phone stores data in **local SQLite**, syncs to **cloud MySQL** (`daftar_db`).
  Sync is **automatic** (on app open / network return) **+ a manual button**.
- **Money:** `DECIMAL(12,2)` on the server; **INTEGER minor units** locally in SQLite.
- **Transactions are append-only/immutable** — corrections are a *reversing entry*, never an edit.
  So `transactions` has **no** `deleted_at`. **Customers** are editable, with soft-delete
  (`deleted_at`) and **last-write-wins** by `updated_at`.
- **UUID primary keys everywhere** (records are created offline before reaching the server).
- **Tenant isolation is MANDATORY:** every query MUST be filtered by `user_id` (enforce in
  middleware). A bug here = one shopkeeper sees another's data — the #1 risk.
- Defaults: currency `YER`, language `ar`, Gregorian dates stored as UTC. Customer `phone` is
  required + unique (uniqueness enforced in the **app layer**, not a hard DB UNIQUE, to work with
  offline + soft-delete).
- **Auth:** JWT + bcrypt (Phase 3).
- **Monetization = paid cloud:** local use is free/trial; a subscription unlocks cloud
  sync/backup; the **server** is the enforcement point (refuses sync if inactive). `users` has
  `plan`, `subscription_status`, `subscription_expires_at`. NOTE: Google Play paid billing is
  likely unavailable in Yemen → plan for **manual server-side subscription activation**.

## Stack
- Frontend: Ionic 8, React 19, TypeScript, Vite, Capacitor 8 (Android), Cypress.
- Backend: Node + Express 4 + TypeScript (CommonJS). MySQL driver added in Phase 3.

## Repo layout
```
daftar-albaqala/
├── src/              # the React/Ionic app (default starter so far — no app code yet)
├── capacitor.config.ts
├── server/           # the backend
│   ├── db/schema.sql # daftar_db tables: users, customers, transactions
│   ├── src/index.ts  # Express app — currently only GET /health
│   ├── package.json  # scripts: dev (tsx watch) / build (tsc) / start (node dist)
│   ├── tsconfig.json
│   ├── .env.example  # template; real .env is created on the server, git-ignored
│   └── .gitignore    # node_modules/, dist/, .env
└── CLAUDE.md
```

## Infrastructure (the server)
- DigitalOcean droplet, **Ubuntu 24.04**, host `idris-server`, public IP **167.71.34.80**.
- Also hosts a **Ghost blog** `shahed.uk` (systemd `ghost_167-71-34-80.service`, behind nginx +
  Cloudflare). Don't break Ghost — it shares this MySQL.
- **MySQL 8.0.46** — was crash-looping after a failed 8.0.45→46 system-table upgrade (SDI
  corruption); on 2026-06-18 it was **fully reinitialized to a clean 8.0.46** (fresh datadir,
  Ghost data re-imported). Admin login: `sudo mysql -u root -p`. Ghost connects **as root**; the
  root password is currently **weak and pending rotation** (it lives in
  `/var/www/ghost/config.production.json` — do not commit it).
- **App database:** `daftar_db` (utf8mb4). **App user:** `daftar_user@localhost`, granted
  **DML only** (SELECT/INSERT/UPDATE/DELETE) on `daftar_db`. Its password is chosen by the owner
  and goes in `server/.env` (`DB_PASSWORD`) — never committed.
- **Backend deploy path:** `/opt/daftar-albaqala` (a `git clone` of this repo via a **read-only
  deploy key**). An older `/opt/daftar-api/` was a manual scaffold and is redundant (safe to delete).

## Deploy workflow (how code reaches the server)
```
edit locally → commit + push (Cursor) → GitHub (private) → on server: git pull
```
- Server auth to GitHub: SSH **deploy key** at `~/.ssh/daftar_deploy`, configured in
  `~/.ssh/config` (`Host github.com → IdentityFile ~/.ssh/daftar_deploy`).
- On the server: `cd /opt/daftar-albaqala && git pull`.

## Onboarding a dev machine (e.g. the Ubuntu ThinkPad)
This is a **development machine** — it edits code and builds the Android app. It is NOT the
server, and does not deploy directly to it (push to GitHub; the droplet pulls).
1. Install **git**, **Node.js 20+** (nvm recommended), and **Cursor** (already present).
2. Clone the repo: in Cursor, sign in to GitHub, then Clone `idrisharif88-rgb/daftar-albaqala`
   (it's **private** — Cursor's GitHub sign-in grants access). Or `git clone` with a token/SSH key.
3. Install dependencies: `npm install` in the repo root (frontend), and `cd server && npm install`
   (backend).
4. Frontend dev: `npm run dev` (Vite). Build Android APK later via Capacitor.
5. Backend can be run locally for testing, but the real backend lives on the droplet
   (`/opt/daftar-albaqala`). The droplet, MySQL, nginx, SSL are managed by the **owner** via the
   DigitalOcean web console.

## Status — DONE
- [x] Frontend scaffolded (default Ionic starter; no app code yet).
- [x] DB schema designed + committed (`server/db/schema.sql`).
- [x] Server MySQL recovered + fully upgraded to clean 8.0.46.
- [x] `daftar_db` + `daftar_user` created; schema loaded (tables `users`, `customers`,
      `transactions` exist).
- [x] Git deploy pipeline working (private repo + server deploy key + clone at
      `/opt/daftar-albaqala`).
- [x] Backend skeleton written: `server/` with a `GET /health` endpoint.
- [x] **Phase 2 DONE — backend live on public HTTPS.** `.env` created on server (DB_PASSWORD set);
      `npm install` done; runs under **pm2** as `daftar-api` (via tsx interpreter — `pm2 start
      src/index.ts --interpreter ./node_modules/.bin/tsx`; no `tsc` build, the droplet stalled on
      it), autostarts on boot (`pm2 startup` → systemd `pm2-root.service`, `pm2 save`). nginx
      reverse proxy at `/etc/nginx/sites-available/shopbook.shahed.uk` → `localhost:3002`;
      Let's Encrypt SSL via certbot. **Public URL: `https://shopbook.shahed.uk/health`** returns ok.
      DNS: Cloudflare A record `shopbook` → 167.71.34.80 (set grey/DNS-only for certbot; can flip
      to orange/proxied after).

- [x] **Phase 3 DONE — auth live.** mysql2 pool (`src/db.ts`), bcryptjs hashing, JWT (`jsonwebtoken`).
      Endpoints: `POST /auth/register`, `POST /auth/login` (`src/routes/auth.ts`), `requireAuth`
      JWT-verify middleware (`src/middleware/auth.ts`, sets `req.userId`), protected `GET /me`.
      `JWT_SECRET` set on server (`openssl rand -hex 32`). Verified end-to-end on
      `https://shopbook.shahed.uk`. NOTE: `daftar_user` MySQL password was reset to match
      `.env` (`DB_PASSWORD`) — it leaked into a chat, so **rotate it** (low priority).
      **UPDATE (Phase 6, 2026-06-27): login identity is PHONE, not email** (Yemen is phone-first).
      `users.email` → `users.phone` (`VARCHAR(32)`, unique `uq_users_phone`); register/login take
      `phone` (normalized to digits, strips spaces/`-`/leading `+`; must be 6–20 digits). ⚠️ The
      **production `daftar_db` still has the old `email` column** — needs an `ALTER`/reload on the
      droplet before deploying this (no real users yet, so low-risk).

## Status — NEXT (Phase 4: customers + transactions CRUD)
- [x] **Customers DONE.** `src/routes/customers.ts` mounted at `/customers` behind `requireAuth`.
      GET (list, excludes soft-deleted) / POST (create, app-layer phone-uniqueness) / PUT
      (update, last-write-wins by `updated_at`) / DELETE (soft-delete tombstone). Every query
      filtered by `req.userId`. Verified live on `https://shopbook.shahed.uk`.
- [x] **Transactions DONE.** `src/routes/transactions.ts` mounted at `/transactions` behind
      `requireAuth`. POST (append-only create: validates type debt/payment, positive amount,
      and that the customer belongs to this owner & is active) / GET `?customer_id=` (list,
      newest first). No update/delete — corrections are reversing entries. Filtered by
      `req.userId`. Verified live on `https://shopbook.shahed.uk`. **Phase 4 complete.**

> ⚠️ **Server RAM is tight (1GB).** On 2026-06-24 it thrashed to load ~22 / OOM
> (MySQL+Ghost+2 node apps + an `appstreamcli` update spike), which froze DNS + all requests;
> a reboot recovered it. **RESOLVED 2026-06-25: a 2GB swap file was added** to absorb spikes.
> When debugging "empty response"/hangs here, still check `free -h; uptime` first.

## Status — DONE (Phase 5: sync + subscription enforcement) ✅
- [x] **`POST /sync/push` DONE.** `src/routes/sync.ts` mounted at `/sync` behind `requireAuth`.
      Body `{ customers:[...], transactions:[...] }`. Customers = upsert by UUID, last-write-wins
      by `updated_at`; transactions = append-only insert-if-new. Cross-owner UUIDs rejected (not
      applied). Whole batch in one DB transaction; returns per-table counts. Verified live on
      `https://shopbook.shahed.uk` (insert then idempotent re-apply).
- [x] **`GET /sync/pull?since=` DONE.** Returns customers (incl. soft-deleted tombstones) with
      `updated_at >= since` + transactions with `created_at >= since`, plus a `synced_at` the
      client stores as its next `since`. `>=` (not `>`) so same-second rows aren't dropped; the
      boundary overlap is harmless (client applies idempotently). Verified live.
- [x] **Subscription enforcement DONE.** `src/middleware/requireSubscription.ts` gates `/sync`
      (`requireAuth, requireSubscription, syncRouter` in `app.ts`): refuses with **402** unless
      `subscription_status='active'` AND not past `subscription_expires_at` (null expiry = no
      expiry). Cloud sync is the paid feature; the server is the enforcement point. Tests:
      `src/test/sync.subscription.test.ts` (5 cases). **Phase 5 complete.**

### Automated tests (sync)
- `server/src/test/` — integration tests for `/sync/push` + `/sync/pull` + subscription gate
  (24 cases) using
  Node's built-in test runner + `supertest`, driving the real Express app (`src/app.ts`, split
  out of `index.ts` so it has no `listen()`). Run with **`npm test`** in `server/`.
- They hit a **real MySQL** `daftar_test` DB — **never** production `daftar_db` (a guard refuses
  to run unless `DB_NAME === 'daftar_test'`). Creds come from `server/.env.test` (git-ignored;
  template `.env.test.example`). Each test wipes + reseeds two tenants, so isolation is real.
- Coverage: last-write-wins (stale skip / newer overwrite), idempotent re-push, append-only
  (no dup transactions), tenant isolation (cross-owner UUID rejected on both tables), input
  validation, pull delta `since` filter, tombstones included, 401/400 paths,
  subscription gate (active allowed; none/expired/past-expiry → 402; future-expiry allowed).
- **One-time test-DB setup** (owner, on droplet `sudo mysql -u root -p`):
  `CREATE DATABASE daftar_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;` then
  `GRANT SELECT,INSERT,UPDATE,DELETE ON daftar_test.* TO 'daftar_user'@'localhost';` then load
  schema as root: `sudo mysql -u root -p daftar_test < server/db/schema.sql`. Then
  `cp server/.env.test.example server/.env.test` and set `DB_PASSWORD` (= the one in `.env`).

## Status — IN PROGRESS (Phase 6: Frontend — the phone app)
The whole backend (auth, customers, transactions, sync, subscription gate) is live and tested.
Now build the actual app the shopkeeper uses. Offline-first: it must work with no network and
sync when one returns (see Architecture — local SQLite INTEGER minor units, UUID PKs).
- [ ] **Local SQLite** — Capacitor SQLite plugin; mirror schema (customers, transactions) with
      INTEGER money (minor units) + UUID PKs; a sync-cursor store for the last `since`.
- [x] **Auth UI DONE.** Login/register screen (`src/pages/Login.tsx`, Arabic/RTL, **phone** + password,
      tel keypad). `src/lib/`: `api.ts` (fetch wrapper + typed `ApiError`, incl. the 402 case),
      `auth.tsx` (`AuthProvider`/`useAuth`, JWT state), `storage.ts` (token in localStorage — will
      move to `@capacitor/preferences` with the data layer), `config.ts` (`API_BASE`). `App.tsx`
      auth-guarded routes (`/login` ↔ `/home`). `index.html` set `lang="ar" dir="rtl"`. Dev: Vite
      proxies `/api` → `localhost:3002` (no CORS); device builds use `VITE_API_BASE` (full https URL).
      Tested in desktop + phone Chrome over LAN (`npm run dev -- --host`). TODO: still handle the
      402 visibly (show a "subscribe" prompt) once sync is wired.
- [ ] **Customer list** — running balances computed from local transactions.
- [ ] **Customer detail** — transaction history; add debt / add payment (append-only; a
      correction is a reversing entry, never an edit).
- [ ] **Settings** — store name, currency (`YER`), language (`ar`), manual sync button.
- [ ] **Wire up sync** — push local changes + pull deltas (`/sync/push`, `/sync/pull?since=`),
      automatic on app open / network return + the manual button; apply LWW / insert-if-new.

> Build in vertical slices; the app default starter is still in `src/` (no app code yet).

## Conventions & constraints
- Work **only** in this repo. Do **NOT** touch the owner's other project `quran-fives-react`.
- The **owner runs all server commands** (SSH/MySQL/nginx/systemd) via the DigitalOcean web
  console; the assistant has no direct server access — always give exact, copy-pasteable commands,
  one logical step at a time, and explain new concepts simply.
- **Secrets** live only in `server/.env` on the server (git-ignored). Never commit real passwords.
- **Every** database query MUST filter by `user_id`.
- Build in **vertical slices**: each step is verified working on the real server before moving on.
