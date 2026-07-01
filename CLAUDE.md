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
- [x] **Local SQLite DONE.** `@capacitor-community/sqlite` (v8.1). Data layer in `src/data/`:
      `schema.ts` (customers + transactions mirror, money INTEGER minor units, ISO-text timestamps,
      per-row `synced` dirty-flag; `app_meta` k/v for the sync cursor), `db.ts` (init + web/native
      handling + `persist()`), `money.ts` (`toMinor`/`fromMinor`/`formatMinor`), `customers.ts`
      (CRUD + soft-delete + app-layer phone-uniqueness), `transactions.ts` (append-only add, list,
      running balance), `uuid.ts` (UUID v4 — `crypto.randomUUID` is undefined over plain-HTTP LAN,
      so falls back to `getRandomValues`). Verified end-to-end on a real phone (debt−payment balance).
      **Web-platform gotchas solved (so the browser dev loop keeps working):** render must not block
      on DB init; `optimizeDeps.exclude: ['jeep-sqlite']` (Vite mangles its Stencil chunks);
      **pin `sql.js` to 1.11.0** to match jeep-sqlite's bundled glue (a mismatched wasm hangs
      `open()` silently); `public/assets/sql-wasm.wasm` is copied from node_modules by the
      `copy-sql-wasm` predev/prebuild script (git-ignored). On a real Android build, native SQLite
      is used and none of the jeep/wasm path runs.
- [x] **Auth UI DONE.** Login/register screen (`src/pages/Login.tsx`, Arabic/RTL, **phone** + password,
      tel keypad). `src/lib/`: `api.ts` (fetch wrapper + typed `ApiError`, incl. the 402 case),
      `auth.tsx` (`AuthProvider`/`useAuth`, JWT state), `storage.ts` (token in localStorage — will
      move to `@capacitor/preferences` with the data layer), `config.ts` (`API_BASE`). `App.tsx`
      auth-guarded routes (`/login` ↔ `/home`). `index.html` set `lang="ar" dir="rtl"`. Dev: Vite
      proxies `/api` → `localhost:3002` (no CORS); device builds use `VITE_API_BASE` (full https URL).
      Tested in desktop + phone Chrome over LAN (`npm run dev -- --host`). TODO: still handle the
      402 visibly (show a "subscribe" prompt) once sync is wired.
- [x] **Customer list DONE.** `src/pages/Home.tsx` now lists active customers
      (`listCustomers()`) with running balances (`getBalance()`, minor units →
      `formatMinor`), colored by direction (positive=owes shop/red "عليه",
      negative=shop owes/green "له", zero="مسدد"). Searchbar filters by name/phone.
      "Add customer" FAB opens an `IonModal` form (name/phone/note) → `createCustomer()`
      (app-layer phone-uniqueness errors surfaced in Arabic). Reloads on
      `useIonViewWillEnter` so balances refresh after the detail screen. Rows are
      not yet tappable — `routerLink` to `/customers/:id` lands with the detail slice.
- [x] **Customer detail DONE.** `src/pages/CustomerDetail.tsx` at route `/customers/:id`
      (registered in `App.tsx`, auth-guarded; reads id via `useParams` since the children-render
      auth pattern doesn't inject route props). Shows a balance summary + transaction history
      (`listTransactions()`, newest first, debt=red / payment=green) and add-debt / add-payment
      buttons → modal (`addTransaction()`, amount entered in major units → `toMinor()`,
      append-only — a correction is a reversing entry, never an edit). Reloads on
      `useIonViewWillEnter`. Home rows are now tappable (`button` + `routerLink` restored).
- [x] **Settings DONE** (manual sync button deferred to the sync slice). `src/pages/Settings.tsx`
      at `/settings` (gear icon in Home header) — store name, currency, language, saved locally in
      `app_meta` via `src/data/settings.ts` (`getSettings`/`saveSettings`). Store name feeds the
      customer notifications below.
- [x] **Customer notifications DONE.** When a debt/payment is recorded, the customer is notified
      **from the grocer's own phone/number**. `src/lib/notify.ts`: `buildMessage` (Arabic: store +
      debt/payment amount + new balance, with the grocer's note folded in on its own line
      `ملاحظة من <store>: …`), `toIntlDigits` (prepends Yemen CC `967`), `sendSms` (auto, no tap —
      **Android-only** via cordova-sms-plugin `window.sms`, no-op on web), `openWhatsApp` (wa.me
      deep link, pre-fills text — WhatsApp can't auto-send, grocer taps send). In `CustomerDetail`
      after save: one combined SMS auto-sends, then an olive action sheet offers «إرسال عبر واتساب»
      / «إلغاء»; cancel — including the **back button / backdrop** — routes through a confirm alert.
      ⚠️ Auto-SMS needs, before the APK build: `npm i cordova-sms-plugin` + `SEND_SMS` permission in
      `AndroidManifest.xml`. Web shows the dialog only (SMS is a no-op there).
- [x] **Sync DONE.** `src/data/sync.ts` (`runSync()`): pushes dirty rows (`synced = 0`) via
      `/sync/push`, marks them clean, then pulls deltas via `/sync/pull?since=<cursor>` and applies
      them (customers LWW by `updated_at`, transactions insert-if-new), advancing the cursor stored
      in `app_meta` (`sync_since`). Idempotent + single-flight (concurrent calls share one run);
      never throws — returns `{status: ok|offline|subscription|error}`. **Money crosses the wire in
      MAJOR units** (server DECIMAL) but is stored locally in INTEGER minor units → `fromMinor` on
      push, `toMinor` on pull. Repo sync helpers added to `customers.ts` / `transactions.ts`
      (`getDirty*`, `mark*Synced`, `applyServer*`). Wire shapes/typed calls in `lib/api.ts`
      (`syncPush`/`syncPull`). **Manual button** «مزامنة الآن» on Settings (toasts the status, incl.
      the **402** subscription case). **Auto-sync** via `<AutoSync>` in `App.tsx`: runs on app open
      (when authenticated) and on the `online` event. **Phase 6 complete.**

> **Phase 6 COMPLETE** (Local SQLite ✓, Auth UI ✓, Customer list ✓, Customer detail ✓, Settings ✓,
> Sync ✓; + a customer-notifications feature). The shopkeeper app now works fully offline and syncs.

## Status — DONE (first Android APK, verified on a real device against the droplet) ✅ (2026-06-29)
- [x] **Android platform added** (`@capacitor/android`, `android/` committed; build artifacts
      git-ignored). Build via Android Studio (`npx cap open android` → Build APK) — **Android Studio
      here is a snap**, so cap can't find it by default: launch `/snap/bin/android-studio <proj>/android`
      or set `CAPACITOR_ANDROID_STUDIO_PATH=/snap/bin/android-studio`. (CLI alt: `cd android &&
      ANDROID_HOME=$HOME/Android/Sdk ./gradlew assembleDebug`; local JDK is 25 — may need 17/21 for CLI.)
- [x] **Auto-SMS prerequisites done:** `cordova-sms-plugin` installed; `SEND_SMS` permission in
      `android/app/src/main/AndroidManifest.xml`. (Plugin requests the runtime permission on first send.)
- [x] **Device build points at the droplet:** `.env.production` sets `VITE_API_BASE=https://shopbook.shahed.uk`
      (the APK has no Vite proxy). **Dev** now also targets the droplet — `vite.config.ts` proxy
      `target` was switched from `localhost:3002` to `https://shopbook.shahed.uk` (revert to localhost
      to use the local backend again).
- [x] **CORS fix — CapacitorHttp enabled** (`capacitor.config.ts`): the native WebView calls the
      droplet cross-origin; the server has **no CORS middleware**, so without this register/login/sync
      fail. CapacitorHttp routes fetch/XHR through native HTTP, bypassing CORS. (If you ever drop
      CapacitorHttp, add `cors()` on the server instead.)
- [x] **Verified on the real phone → real server:** registered + logged in on the device, added
      customers + debts/payments, and **/sync pushed them to the droplet `daftar_db`** (amounts stored
      correctly as DECIMAL major units). WhatsApp + SMS confirmed sending. **Droplet `daftar_db` was
      reloaded fresh** from `server/db/schema.sql` (now phone-based, old `email` column gone).

## Status — DONE (Phase 6.5: device-feedback round, all verified on the real phone) ✅ (2026-06-30)
Seven fixes/features from owner testing, each built + device-tested one at a time:
- [x] **Per-user local data (the old KNOWN BUG, FIXED).** `src/data/owner.ts` `ensureLocalOwner(userId,
      storeName)` records the owning `user_id` in `app_meta`; on a user switch it wipes local
      `customers` / `transactions` / `app_meta` so a new account never shows the previous grocer's
      data, then re-seeds store name. Called in `auth.tsx` login + register, **awaited before
      `setAuthed(true)`** so AutoSync pulls into a clean store. (Caveat: a switch discards unsynced
      local rows — fine for one-grocer-per-phone.)
- [x] **Block data entry until activated.** `src/data/account.ts` mirrors the server's subscription
      gate into a local flag (`account_active` in `app_meta`): a successful sync ⇒ active, a **402**
      ⇒ blocked; **default = blocked**. Add-customer FAB + add-debt/payment refuse with the Arabic
      prompt «حسابك غير مفعّل. تواصل مع المالك لتفعيل حسابك.» until activation. Owner activates on the
      droplet (`UPDATE daftar_db.users SET subscription_status='active' WHERE …;`) then a sync unblocks.
- [x] **Android hardware back, all screens + overlays.** `HardwareBack` handler in `App.tsx`
      (`useIonRouter`, `ionBackButton` priority 10): dismisses the topmost **visible** overlay (select
      popover / modal / alert) first — found by real rendered size, not DOM presence, which fixed a
      popover left orphaned after navigating — else navigates back.
- [x] **Double-tap back to exit at the root.** At home/login, first back toasts «اضغط مرة أخرى
      للخروج»; a second press within 2s calls `CapacitorApp.exitApp()` (`@capacitor/app`).
- [x] **Pick phone from contacts.** `@capacitor-community/contacts` (7.2.0; built for Cap 7 but
      syncs/works on Cap 8) + `READ_CONTACTS`. `src/lib/contacts.ts` opens the native picker (Android
      only; web no-op) → fills name + first phone in the add-customer modal («اختيار من جهات الاتصال»).
- [x] **Sync-success toast polished.** «تمت المزامنة» now a checkmark icon on a dark-green
      `.toast-sync-ok` (Home + Settings).
- [x] **Per-customer PDF statement.** `src/lib/pdf.ts`: export button on `CustomerDetail` → action
      sheet (اليوم / هذا الشهر / كل الحركات) → builds an Arabic/RTL HTML statement, snapshots it with
      **html2canvas** and embeds the image in a multi-page A4 **jsPDF** (sidesteps jsPDF's broken
      Arabic shaping — image-based, not selectable text). Native writes to `Directory.Cache` + system
      **Share** sheet; web downloads. Deps: `jspdf`, `html2canvas`, `@capacitor/filesystem`,
      `@capacitor/share`.

## Status — DONE (Phase 6.6: device-feedback round 2, all verified on the real phone) ✅ (2026-07-01)
Five owner-reported items, each built + device-tested against the droplet:
- [x] **Cross-account data leak FIXED.** `ensureLocalOwner` (`src/data/owner.ts`) wiped the previous
      grocer's store with a **single-line `;`-joined** `DELETE` batch. The Android SQLite plugin
      splits a batch on `";\n"`, so the whole line was one statement and `execSQL` ran only the FIRST
      — transactions were deleted (balances → 0) but **customers survived**, leaking account A's
      customers into account B. Fix: each `DELETE` on its own line. (Worked in the browser because
      web sql.js runs multi-statement strings — a web-vs-native divergence.)
- [x] **Contacts picker FIXED + relabelled.** The `@capacitor-community/contacts` permission alias
      `"contacts"` bundles **READ + WRITE**, and `getPermissionState` grants only when BOTH are
      declared. The manifest had only `READ_CONTACTS`, so the alias was permanently denied and
      `pickContact` bailed before opening. Fix: added **`WRITE_CONTACTS`** (unused, but required by
      the alias). Button label shortened «اختيار من جهات الاتصال» → «جهات الاتصال».
- [x] **In-app activation requests.** New `POST /account/request-activation` (`server/src/routes/account.ts`),
      mounted behind `requireAuth` **but NOT `requireSubscription`** (an inactive account is the one
      that must reach it). Stamps new `users.activation_requested_at` + `activation_message` columns.
      Client: `requestActivation()` in `lib/api.ts`; a «طلب التفعيل» button on Settings (optional-note
      alert) shown only while inactive. Tests: `server/src/test/account.test.ts` (5 cases; suite 29/29).
      **Migration required** (DDL — `daftar_user` is DML-only, run as root on the droplet):
      `ALTER TABLE daftar_db.users ADD COLUMN activation_requested_at DATETIME NULL, ADD COLUMN activation_message VARCHAR(255) NULL;`
      Owner lists pending: `SELECT phone, store_name, activation_requested_at, activation_message FROM
      users WHERE subscription_status<>'active' AND activation_requested_at IS NOT NULL;` **(migration applied on droplet ✓)**
- [x] **PDF statement → WhatsApp.** Export now hands the PDF to WhatsApp **with the file attached**;
      the grocer picks which customer to send to. (WhatsApp's public API can't pre-select a chat AND
      attach a file — the `api.whatsapp.com/send?phone=` link is text-only — so we guarantee the
      attachment; owner chose this over the flaky `jid` trick.) `src/lib/pdf.ts` calls
      **cordova-plugin-x-socialsharing** `shareViaWhatsApp` with a `df:…;base64` PDF, falling back to
      the system share sheet if WhatsApp isn't installed. Added a **`<queries>`** entry for
      `com.whatsapp`(`.w4b`) so the `ACTION_SEND` intent resolves on Android 11+. ⚠️ The plugin's
      **FileProvider + `sharing_paths.xml`** live in the **regenerated (git-ignored)
      `capacitor-cordova-android-plugins` module** — so **`npx cap sync android` MUST run before every
      APK build** or the share crashes / the fix is absent. (Don't re-declare that provider in the app
      manifest — duplicate authority breaks the merge.)
- [x] "activation gate block" item — owner confirmed already working; no change.

> **Network note (login latency):** the phone APK login takes ~3–4s and that's ACCEPTED (not a bug).
> Cause: RTT to the droplet is ~376ms and each login opens a **cold** TLS connection (~3–4 round
> trips). Chrome feels instant only because it **reuses** a warm connection. Server is fine (TLS 1.3
> + HTTP/2, load ~0). A separate **"minutes / can't connect"** failure the owner once saw is a
> DIFFERENT mode — either the **1GB droplet briefly overloading** (check `free -h; uptime`) or a
> **network blip** (login/sync have **no request timeout**, so a flaky link hangs instead of failing
> fast). Possible future polish: add a ~15s fetch timeout so it errors cleanly. Cloudflare-proxy
> (orange-cloud) to cut RTT was attempted but never took effect.

> ▶ **RESUME HERE:** Phase 7 (WhatsApp OTP). To test sync, the user's `subscription_status` must be
> `active` in the droplet `daftar_db`
> (`sudo mysql -u root -p -e "UPDATE daftar_db.users SET subscription_status='active';"`) or sync returns 402.

## Status — PLANNED (Phase 7: phone verification via WhatsApp OTP)
**Decided 2026-06-27 (owner):** verify the phone at registration so only the real owner of a
number can make an account — via **WhatsApp OTP, NOT SMS** (WhatsApp penetration in Yemen is far
higher; carrier SMS deliverability via global gateways is poor/pricey). **Deferred** until the
core app works — the subscription gate already neutralizes fake accounts (server refuses sync
until the owner manually activates, so an unverified account is inert).
- Pre-req: **prove WhatsApp OTP actually delivers to a real Yemeni number** before building, and
  pick a provider — WhatsApp Business API needs a verified Meta business + an approved
  *authentication* message template (via Meta Cloud API directly, or Twilio/360dialog).
- Shape (small): `users.phone_verified` flag + a `verification_codes` table (phone, code_hash,
  expires_at, attempts); `POST /auth/request-otp` + `POST /auth/verify-otp`; **rate-limit** the
  request endpoint hard (OTP endpoints get abused to burn credit / spam numbers).

## Conventions & constraints
- Work **only** in this repo. Do **NOT** touch the owner's other project `quran-fives-react`.
- The **owner runs all server commands** (SSH/MySQL/nginx/systemd) via the DigitalOcean web
  console; the assistant has no direct server access — always give exact, copy-pasteable commands,
  one logical step at a time, and explain new concepts simply.
- **Secrets** live only in `server/.env` on the server (git-ignored). Never commit real passwords.
- **Every** database query MUST filter by `user_id`.
- Build in **vertical slices**: each step is verified working on the real server before moving on.
