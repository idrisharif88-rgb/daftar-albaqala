-- ============================================================
-- Migration 007 — attachments (a file on an entry)
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/007_attachments.sql
-- Local dev + test: the same file against daftar_db AND daftar_test, or
--   sudo bash server/db/local-reset.sh  (reloads both from schema.sql).
--
-- WHY: the owner wants to pin a file to an entry — a product photo, a picture
-- of the paper invoice, a screenshot proving a payment went through. The file
-- belongs to the ACCOUNT, so it syncs: the metadata row travels like the other
-- tables (upsert by UUID, soft-delete via deleted_at, delta by server_updated_at),
-- while the BYTES travel on their own endpoints (routes/attachments.ts) and are
-- stored on disk under ATTACH_DIR, NOT in this row — a DECIMAL column is the
-- wrong place for a megabyte of JPEG, and a blob in every SELECT is a tax on
-- every query that never wanted it.
--
-- `size` is the stored (compressed) byte count, kept so a client can show it
-- without fetching the file. `mime` is validated by the route to an allowlist
-- (image/*, application/pdf) — the column itself is permissive.
--
-- Idempotent: safe to run twice.
-- ============================================================

CREATE TABLE IF NOT EXISTS attachments (
  id              CHAR(36)      NOT NULL,
  user_id         CHAR(36)      NOT NULL,              -- owner (tenant isolation)
  transaction_id  CHAR(36)      NOT NULL,              -- the entry this is pinned to
  mime            VARCHAR(100)  NOT NULL,              -- e.g. image/jpeg, application/pdf
  filename        VARCHAR(255)  NOT NULL DEFAULT '',   -- display name only
  size            INT           NOT NULL DEFAULT 0,    -- stored byte count
  created_at      DATETIME      NOT NULL,
  deleted_at      DATETIME      NULL,                  -- tombstone (syncs)

  server_updated_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  CONSTRAINT fk_att_user FOREIGN KEY (user_id)        REFERENCES users(id),
  CONSTRAINT fk_att_txn  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  KEY idx_att_user_txn (user_id, transaction_id),
  KEY idx_att_sync (user_id, server_updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
