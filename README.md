# Daftar al-Baqala (دفتر البقالة)

An offline-first, multi-tenant mobile app for grocery store owners to track customer
debts and payments. Works fully offline on the phone and syncs to the owner's cloud
server. Arabic-first, RTL.

## Highlights
- **Offline-first architecture** — the phone runs on local SQLite and works with no
  connection; data syncs to cloud MySQL automatically on app open / network return, plus
  a manual sync button.
- **Multi-tenant with strict isolation** — every request is scoped per owner through
  middleware, so no shopkeeper can ever see another's data.
- **Correctness-first money model** — transactions are append-only and immutable;
  corrections are reversing entries, never edits. Amounts stored as DECIMAL on the server
  and integer minor units on the device to avoid floating-point drift.
- **Conflict-safe sync** — UUID primary keys generated offline, last-write-wins on
  editable records, soft-delete, and idempotent writes so a replayed request never
  double-applies.
- **Subscription-gated cloud** — the server is the enforcement point: it refuses to sync
  an inactive account, with in-app activation requests.
- **Real-device features** — pick customers from phone contacts, hardware-back handling,
  and per-customer PDF statements (Arabic/RTL) shareable over WhatsApp.

## Stack
Ionic 8 · React 19 · TypeScript · Vite · Capacitor 8 (Android) · Cypress
Node.js · Express · MySQL 8 · JWT + bcrypt

## Status
Active development. Core debt/payment tracking, auth, subscription gating, and
device-tested sync are working end to end against a live server.
