// The on-phone SQLite schema. Mirrors the server's daftar_db (customers,
// transactions) but with local-storage adaptations:
//   - money is INTEGER minor units (not DECIMAL) — see money.ts
//   - timestamps are TEXT ISO-8601 UTC strings (SQLite has no datetime type)
//   - every row carries `synced` (0 = local change not yet pushed to the server)
//
// UUID text PKs everywhere (records are born offline). Transactions are
// append-only (no deleted_at); customers are editable + soft-deleted.

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
  id          TEXT PRIMARY KEY NOT NULL,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  synced      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id           TEXT PRIMARY KEY NOT NULL,
  customer_id  TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('debt','payment')),
  amount       INTEGER NOT NULL CHECK (amount > 0),
  note         TEXT,
  occurred_at  TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  synced       INTEGER NOT NULL DEFAULT 0
);

-- Small key/value store for app state, e.g. the last sync cursor.
CREATE TABLE IF NOT EXISTS app_meta (
  key    TEXT PRIMARY KEY NOT NULL,
  value  TEXT
);

CREATE INDEX IF NOT EXISTS idx_txn_customer ON transactions (customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cust_synced  ON customers (synced);
CREATE INDEX IF NOT EXISTS idx_txn_synced   ON transactions (synced);
`;
