-- ============================================================
-- Migration 027 — «دفتر النادي»: subscription periods (Phase 43, step 3).
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/027_club_subscriptions.sql
-- Local dev + test: the same file against daftar_db AND daftar_test.
--
-- A subscriber is an ordinary contact (role 'member'); what he owes is in the
-- ledger as usual (the subscription = one debt entry, `transaction_id`). This
-- table only adds what the ledger has no place for: the package and its
-- dates. `price` may be below `list_price` — a discount for this subscriber.
-- Synced like items: upsert by UUID, last-write-wins, tombstones.
-- ============================================================
CREATE TABLE IF NOT EXISTS club_subscriptions (
  id              CHAR(36)      NOT NULL,
  user_id         CHAR(36)      NOT NULL,
  customer_id     CHAR(36)      NOT NULL,
  package_name    VARCHAR(80)   NOT NULL,
  days            SMALLINT      NOT NULL,
  list_price      DECIMAL(12,2) NOT NULL,
  price           DECIMAL(12,2) NOT NULL,
  currency        VARCHAR(8)    NOT NULL DEFAULT 'YER',
  start_date      DATE          NOT NULL,
  end_date        DATE          NOT NULL,
  transaction_id  CHAR(36)      NULL,
  note            VARCHAR(255)  NULL,
  created_at      DATETIME      NOT NULL,
  updated_at      DATETIME      NOT NULL,
  deleted_at      DATETIME      NULL,

  server_updated_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  CONSTRAINT fk_csub_user FOREIGN KEY (user_id)     REFERENCES users(id),
  CONSTRAINT fk_csub_cust FOREIGN KEY (customer_id) REFERENCES customers(id),
  KEY idx_csub_user_cust (user_id, customer_id),
  KEY idx_csub_sync (user_id, server_updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
