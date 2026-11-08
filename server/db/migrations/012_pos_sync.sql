-- ============================================================
-- Migration 012 — point-of-sale tables (sync of the POS section)
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/012_pos_sync.sql
-- Local dev + test: the same file against daftar_db AND daftar_test.
--
-- WHY separate tables and a separate endpoint (/pos-sync): the POS data is a
-- different domain from the ledger, and the ledger's sync is the most
-- important code in the app. Nothing here touches it.
--
-- Money is INTEGER minor units, exactly as on the phone (no DECIMAL
-- conversion to get wrong). `day` is the shop's LOCAL calendar day as text,
-- «YYYY-MM-DD» — a bakery's day is not UTC's.
-- ============================================================

CREATE TABLE IF NOT EXISTS pos_products (
  id          CHAR(36)     NOT NULL,
  user_id     CHAR(36)     NOT NULL,
  name        VARCHAR(255) NOT NULL,
  code        CHAR(13)     NOT NULL,              -- EAN-13, issued once, never edited
  price       BIGINT       NOT NULL DEFAULT 0,    -- minor units
  created_at  DATETIME(3)  NOT NULL,
  updated_at  DATETIME(3)  NOT NULL,
  deleted_at  DATETIME(3)  NULL,                  -- tombstone (synced)
  server_updated_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pos_product_code (user_id, code),
  KEY idx_pos_product_sync (user_id, server_updated_at),
  CONSTRAINT fk_pos_product_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add-only: what was baked (a negative qty is a correction).
CREATE TABLE IF NOT EXISTS pos_baked (
  id          CHAR(36)    NOT NULL,
  user_id     CHAR(36)    NOT NULL,
  product_id  CHAR(36)    NOT NULL,
  day         CHAR(10)    NOT NULL,
  qty         INT         NOT NULL,
  created_at  DATETIME(3) NOT NULL,
  server_updated_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_pos_baked_sync (user_id, server_updated_at),
  KEY idx_pos_baked_day (user_id, day),
  CONSTRAINT fk_pos_baked_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add-only: one row per sale (qty 1, or -1 for a take-back), at the price it
-- was made at.
CREATE TABLE IF NOT EXISTS pos_sales (
  id          CHAR(36)    NOT NULL,
  user_id     CHAR(36)    NOT NULL,
  product_id  CHAR(36)    NOT NULL,
  day         CHAR(10)    NOT NULL,
  qty         INT         NOT NULL,
  price       BIGINT      NOT NULL,               -- minor units, at the time
  created_at  DATETIME(3) NOT NULL,
  server_updated_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_pos_sales_sync (user_id, server_updated_at),
  KEY idx_pos_sales_day (user_id, day),
  CONSTRAINT fk_pos_sales_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A day whose baked quantities were submitted. Last-write-wins by updated_at.
CREATE TABLE IF NOT EXISTS pos_day_lock (
  user_id     CHAR(36)    NOT NULL,
  day         CHAR(10)    NOT NULL,
  locked_at   DATETIME(3) NULL,                   -- NULL = reopened for a correction
  reopened    INT         NOT NULL DEFAULT 0,
  updated_at  DATETIME(3) NOT NULL,
  server_updated_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, day),
  KEY idx_pos_lock_sync (user_id, server_updated_at),
  CONSTRAINT fk_pos_lock_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
