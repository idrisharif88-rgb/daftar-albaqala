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
├── src/                     # the React/Ionic app that runs on phones
│   ├── pages/               # ledger screens: Home, CustomerDetail, Items, Invoice, Settings, Login, Welcome, UpdatesNotebook
│   ├── features/pos/        # the POS section (Phase 32): Today/Sell/History/Products pages, stock + products
│   │                        #   data, posSync (+ kick), labels/report PDFs, scanner, beep, icons registry
│   ├── data/                # local SQLite layer: db, schema (baseline), migrations (versioned), sync, driveBackup, ...
│   ├── lib/                 # api, auth, notify, pdf, receipt, print, systemPrint, googleDrive, productCodes, ...
│   ├── flavors/             # grocery / contractor differences, chosen at BUILD time (VITE_FLAVOR)
│   └── components/ theme/ config.ts   # config.ts holds POS_ENABLED (VITE_POS) and the owner phone
├── android/                 # Capacitor Android: flavors grocery + contractor, build type `postest`,
│                            #   custom plugins (ContactPicker, FilePicker, SystemPrint, NativeSplash)
├── watcher/                 # «مراقب البقالة» — the owner's admin app (own package.json + android/)
├── server/                  # the backend (Express + TypeScript)
│   ├── db/schema.sql        # full schema (users, customers, transactions, items, item_groups, user_settings,
│   │                        #   attachments, pos_* tables)
│   ├── db/migrations/       # numbered DDL 001–012, run as root (daftar_user is DML-only)
│   ├── src/app.ts           # mounts the routers below; index.ts only calls listen()
│   ├── src/routes/          # auth, customers, transactions, sync, posSync, attachments, account, admin
│   ├── src/middleware/      # auth, requireSubscription, requirePos, requireAdmin, requireAdminCode
│   ├── src/admin/           # hand-written TOTP for the Watcher login
│   ├── src/test/            # integration tests against a real MySQL (`npm test`)
│   └── .env.example / .env.test.example   # templates; real .env files are git-ignored
├── scripts/flavor-assets.sh # moves each app's web build into its own Android source set
├── docs/privacy.html        # privacy policy, published on GitHub Pages
├── docs/HISTORY.md          # full write-up of every phase (read before changing a feature)
├── play-assets/             # Play Store listing material
├── cypress/ cursorrules     # e2e scaffold; the owner's reverse-learning guide
└── CLAUDE.md                # this file — update it after every phase
```

## Infrastructure (the server)
- DigitalOcean droplet, **Ubuntu 24.04**, host `idris-server`, public IP **167.71.34.80**.
- Also hosts a **Ghost blog** `shahed.uk` (systemd `ghost_167-71-34-80.service`, behind nginx +
  Cloudflare). Don't break Ghost — it shares this MySQL.
- **MySQL 8.0.46** — was crash-looping after a failed 8.0.45→46 system-table upgrade (SDI
  corruption); on 2026-06-18 it was **fully reinitialized to a clean 8.0.46** (fresh datadir,
  Ghost data re-imported). Admin login: `sudo mysql -u root -p`. Ghost connects **as root**; the
  root password was **rotated to a strong value on 2026-09-09** (it lives in
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

### Local dev environment — set up on the ThinkPad 2026-06-27 (how to resume)
The full backend can now be run + tested **locally** (no droplet needed for dev):
- **Local MySQL** installed. Two DBs: `daftar_db` (manual e2e) + `daftar_test` (`npm test`).
  App user `daftar_user` / password **`Daftar_Local_1!`** (local only — not the server's secret).
  Set in `server/.env` and `server/.env.test` (git-ignored).
- **Git-ignored helper scripts** (local, hold the password): `server/db/local-setup.sql`
  (create DBs+user), `local-load-schema.sh`, `local-reset.sh` (drop+reload after a schema change,
  run as `sudo bash …`). MySQL's password policy rejects weak passwords — keep the compliant one.
- **Run the backend:** `cd server && npm run dev` → `http://localhost:3002`. Tests: `npm test` (24/24).
- **Run the app:** `npm run dev -- --host` → opens on the LAN. **Test on the real phone** (Note 9,
  same WiFi) at **`http://192.168.0.43:5173`** (laptop's LAN IP — re-check with `hostname -I`).
  The app calls `/api/*`, which Vite **proxies** to `localhost:3002` (no CORS); device/prod builds
  use `VITE_API_BASE` instead (`src/config.ts`).
- **To unlock sync for a local test user** (sync is gated by subscription): in `daftar_db`,
  `UPDATE users SET subscription_status='active' WHERE id='…';` (mirrors real server-side activation).
- **Note:** local phone testing is over plain HTTP, so `crypto.randomUUID` is unavailable → we use a
  `getRandomValues` fallback (`src/data/uuid.ts`). SQLite in the browser needs `sql.js` pinned to
  **1.11.0** (matches jeep-sqlite's glue) — don't bump it without re-verifying on the phone.
- **`cursorrules`** (repo root): owner's reverse-learning guide — drop short **English** `🧩 Server
  concept:` callouts when code touches a server/infra/security concept.

## 📚 Full history → `docs/HISTORY.md`
Every phase's full write-up (the WHY behind each decision) lives in **`docs/HISTORY.md`**,
moved there verbatim on 2026-11-25 to keep this file small. **Read the matching phase there
before changing a feature.** After each phase: full write-up → HISTORY.md, one line → below.

## Phases at a glance
- 2–5: backend live (`https://shopbook.shahed.uk`, pm2 `daftar-api`), auth by **phone**, customers,
  transactions, `/sync/push` + `/sync/pull`, subscription gate (402).
- 6–6.6: phone app — local SQLite, auth UI, list/detail, settings, sync, notices, PDF, per-user wipe.
- 8: multi-currency (YER/SAR/USD/GOLD), roles, per-row sync acks, server clock + keyset cursor, Excel.
- 9: role vocabulary (زبون / صاحب متجر / شريك), message layout, تفقيط.
- 10: settings sync, price list (`items`), invoices, Bluetooth receipt printing.
- 11: invoice review, invoice-shaped message, item groups. 12: SMS by intent. 13: no notice, no entry.
- 14: contacts by picker. 15: SMS fits 469 chars. 16: Arabic name, Latin digits. 17: «إشعار حركة».
- 18–19: system print + bold 1.5× receipt; record+print notifies first.
- 20–21: Watcher (admin app, TOTP) — accounts, open a book, delete/reverse entries.
- 22: Google Cloud + device prefs sync. 23: contractor flavor «دفتر المقاول». 24–25: Settings + Drive safety.
- 26–31: Watcher delete account / rename / password; sync on/off (free = phone + Drive); app renamed «فليكتب».
- 32: POS section (`src/features/pos/`, `/pos-sync`), staff, notes, sync consent.
- 33–35: debt limit + SMS reminders (`direct` build only), cashier report, test-notes round.
- 36–41: manager PIN, staff chat, sync request flow, live line (SSE), direct sync enable, multi-device.
- 42: phone verification, account activation, invoice quick-add, welcome, shop logo + intro.
- 43: «دفتر النادي» club section (`src/features/club/`). Releases: 2.2 (13), 2.3 (15), 2.4 (16).

## ⚠️ Rules that still bite (details in HISTORY.md)
- **Never re-add** `SEND_SMS` (except the `direct` build type, never shipped to Play),
  `READ_CONTACTS` / `WRITE_CONTACTS`, `cordova-sms-plugin`, `@capacitor-community/contacts`.
  Check the **merged** manifest (rebuild first — stale merged manifests lie).
- **Hand-written SQL on `customers`** MUST set `updated_at=UTC_TIMESTAMP()` or phones discard it.
- **Local schema:** add columns only via `src/data/migrations.ts` (`PRAGMA user_version`), never `schema.ts`.
  Server DDL = `server/db/migrations/NNN_*.sql`, run as **root** (latest: **027**); deploy server
  before the app. Update `schema.sql` too.
- **SQLite on Android:** multi-statement `execSQL` splits on `";\n"` — one statement per line.
- **Account switch wipe** (`src/data/owner.ts`) must include every new local table.
- **Sync cursor** is versioned (now `v4`); old versions must still decode, new tables start from zero.
- **Money on the wire = major units**, local = INTEGER minor units.
- **Dates in messages/PDF:** build by hand with Latin digits; never `toLocaleString('ar')`.
- **Ionic overlays:** one overlay per hook instance — a sheet opened from another sheet on the
  SAME hook silently never appears. Use a second hook.
- **`npx cap sync android` before every APK**; Android builds via `npm run android:grocery` /
  `android:contractor` (`scripts/flavor-assets.sh`). Play builds: `VITE_POS=1 npm run android:grocery`
  + `bundleGroceryRelease`. New Capacitor plugin → add to `proguard-rules.pro` keep rules.
- **Gradle JDK = java-21-openjdk** (snap Android Studio's JDK 25 is rejected).
- **Admin routes** (`/admin/*`) are the only ones not filtered by `user_id` — keep them behind `requireAdmin`;
  every admin change needs a fresh TOTP code (`requireAdminCode`).
- **`npm run dev` has no Google client ID** → Drive is always hidden in the browser dev loop.
- Frontend unit tests: `npx vitest run src/lib` (and `src/`); server: `cd server && npm test`.
- When two owner instructions conflict → **ask**, don't pick the later one.

## Open / not done
- **Play blockers:** paid activation outside Play (no price wording in-app); Data Safety answers;
  plugin-injected permissions still in the merged manifest (`ACCESS_COARSE_LOCATION`,
  `READ/WRITE_EXTERNAL_STORAGE`, `USE_BIOMETRIC/FINGERPRINT`, `VIBRATE`); edge-to-edge (Android 15).
- **No monitoring:** external uptime check on `/health` still missing; `runSync()` reports a dead
  server as «لا يوجد اتصال بالإنترنت».
- **Not device-tested:** many phases (11–19, 21, 24–27, 33–35, 42, 43) — see each in HISTORY.md.
- **Printer:** no real 80mm thermal unit tested yet.
- **Contractor app:** release + Play OAuth clients, signing, Play listing.
- **Phase 7 (WhatsApp OTP):** planned, deferred (Phase 42's manual code covers it for now).
- «تذكير فليكتب» as a separate app (decided, not built — then remove the `direct` build).
- Rotate `daftar_user`'s MySQL password (leaked once in chat, low priority).

## Conventions & constraints
- **Keep this file current.** After every phase: full write-up in `docs/HISTORY.md`, one line in
  «Phases at a glance», and update the rules / open lists above. Memory notes are not a substitute.
- Work **only** in this repo. Do **NOT** touch the owner's other project `quran-fives-react`.
- The **owner runs all server commands** (SSH/MySQL/nginx/systemd) via the DigitalOcean web
  console; the assistant has no direct server access — always give exact, copy-pasteable commands,
  one logical step at a time, and explain new concepts simply.
- **Secrets** live only in `server/.env` on the server (git-ignored). Never commit real passwords.
- **Every** database query MUST filter by `user_id`.
- Build in **vertical slices**: each step is verified working on the real server before moving on.
- Server RAM is tight (1GB + 2GB swap). On "empty response"/hangs check `free -h; uptime` first;
  if `/health` times out while DNS resolves → `systemctl status nginx`.
