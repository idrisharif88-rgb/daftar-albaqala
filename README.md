# Daftar al-Baqala (دفتر البقالة)

[![CI](https://github.com/idrisharif88-rgb/daftar-albaqala/actions/workflows/ci.yml/badge.svg)](https://github.com/idrisharif88-rgb/daftar-albaqala/actions/workflows/ci.yml)

An offline-first, multi-tenant mobile app for grocery store owners to track customer
debts and payments. Arabic-first, RTL. **In real-world use** — the backend is live in
production on a private server and the Android app is used daily.

Instead of a paper notebook full of "Ahmed owes 500, paid 200," a shopkeeper records
customers and their debts/payments on their phone. The app keeps each person's running
balance, works with no internet, and syncs safely to the cloud when a connection returns.

## Highlights

- **Offline-first by design** — the phone runs on local SQLite and is fully usable with
  no connection. Data syncs to cloud MySQL automatically on app open and network return,
  plus a manual sync button.
- **Multi-tenant with strict isolation** — every request is scoped per owner in
  middleware, so no shopkeeper can ever see another's data. This is the project's #1
  safety rule and it's enforced on every query.
- **Correctness-first money model** — transactions are append-only and immutable;
  corrections are reversing entries, never edits. Amounts are stored as DECIMAL on the
  server and integer minor units on the device to avoid floating-point drift.
- **Conflict-safe sync** — UUID keys generated offline, last-write-wins on editable
  records, soft-delete tombstones, server-stamped delta clock, keyset paging, and
  per-row acknowledgement so a rejected row is never silently lost.
- **Multi-currency ledger** — YER, SAR, USD and gold-by-the-gram. The debt is kept in its
  own currency; a reference figure in riyals is recomputed at the owner's set rate.
- **Documents people actually hand over** — itemised invoices built from a per-contact
  price list, Arabic/RTL PDF statements, Excel export, and 80mm Bluetooth receipt
  printing. Arabic is drawn to a bitmap so it stays correctly shaped and joined.
- **Customer notices** — a debt or payment can be sent to the customer over WhatsApp or
  SMS, pre-filled and signed by the shop, with the balance spelled out in Arabic words.
- **Subscription-gated cloud** — the server is the enforcement point: it refuses to sync
  an inactive account. Cloud backup is the paid feature; local use is free.
- **Play Store hardening** — permissions reduced to the minimum (contacts via the system
  picker, SMS by intent — no held permissions), verified against the merged manifest.

## Stack

**App:** Ionic 8 · React 19 · TypeScript · Vite · Capacitor 8 (Android) · Cypress
**Backend:** Node.js · Express · TypeScript · MySQL 8 · JWT + bcrypt
**Infra:** DigitalOcean · nginx + Let's Encrypt · pm2 · Cloudflare

## Engineering notes

- The backend runs live behind HTTPS with an automated deploy pipeline
  (push → GitHub → server pull).
- The sync layer is covered by an integration test suite (60+ cases) driving the real
  Express app against a real MySQL test database, including tenant-isolation and
  data-loss regression cases.
- Built and shipped in vertical slices — each feature verified working on a real device
  against the live server before moving on.

## Status

Actively developed and in production use. Backend (auth, customers, transactions, sync,
subscription gating) is live and tested; the Android app covers the full shopkeeper
workflow — customers, debts/payments, invoices, statements, multi-currency, and
notifications — offline with cloud sync. Currently preparing for a Google Play release.
