-- ============================================================
-- Migration 003 — per-contact price list (items)
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/003_items.sql
-- Local dev + test: sudo bash server/db/local-reset.sh reloads both DBs
-- from schema.sql instead.
--
-- WHY: the owner records the same purchases from the same shops over and over.
-- Keeping each shop's goods and their last price means recording one is a tap
-- rather than a sum, and it is what an invoice is built from. The list belongs
-- to the ACCOUNT, not to one phone, so it syncs like contacts do: upsert by
-- UUID, last-write-wins by updated_at, soft-delete via deleted_at.
--
-- NOT inventory: nothing here counts stock. `price` is the last price paid.
--
-- Idempotent: safe to run twice.
-- ============================================================

CREATE TABLE IF NOT EXISTS items (
  id           CHAR(36)      NOT NULL,
  user_id      CHAR(36)      NOT NULL,
  customer_id  CHAR(36)      NOT NULL,
  name         VARCHAR(128)  NOT NULL,
  price        DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency     VARCHAR(8)    NOT NULL DEFAULT 'YER',
  note         TEXT          NULL,
  created_at   DATETIME      NOT NULL,
  updated_at   DATETIME      NOT NULL,
  deleted_at   DATETIME      NULL,

  server_updated_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  CONSTRAINT fk_item_user FOREIGN KEY (user_id)     REFERENCES users(id),
  CONSTRAINT fk_item_cust FOREIGN KEY (customer_id) REFERENCES customers(id),
  KEY idx_item_user_cust (user_id, customer_id),
  KEY idx_item_sync (user_id, server_updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
