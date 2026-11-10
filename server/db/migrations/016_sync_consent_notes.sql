-- ============================================================
-- Migration 016 — server-sync consent + POS notes
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/016_sync_consent_notes.sql
-- Local dev + test: the same file against daftar_db AND daftar_test.
--
-- users.sync_consent — the shopkeeper's OWN answer to «may your book be kept on
--   the server?». Switching sync on in the Watcher no longer starts it: it
--   asks (pending), and the server refuses sync until the shopkeeper approves.
--   'rejected' — or a later withdrawal from Settings — stops it again.
--   Accounts already syncing are recorded as approved: they agreed by asking
--   for it, and nothing about them changes.
-- users.pos_notes_enabled — the POS notes feature, switched on per shop by the
--   developer (Watcher). Off = no notes travel, either way.
-- pos_notes — short notes written at the point of sale by the owner or by a
--   staff member holding the `notes` permission. Add-only; the owner may
--   delete one (a tombstone, so the deletion reaches every phone).
-- ============================================================
ALTER TABLE users
  ADD COLUMN sync_consent ENUM('none','pending','approved','rejected') NOT NULL DEFAULT 'none' AFTER contractor_status,
  ADD COLUMN sync_consent_at DATETIME(3) NULL AFTER sync_consent,
  ADD COLUMN pos_notes_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER pos_staff_enabled;

UPDATE users SET sync_consent = 'approved', sync_consent_at = UTC_TIMESTAMP(3)
 WHERE subscription_status = 'active' OR contractor_status = 'active';

CREATE TABLE IF NOT EXISTS pos_notes (
  id               CHAR(36)      NOT NULL,
  user_id          CHAR(36)      NOT NULL,              -- the OWNER (the shop)
  author_staff_id  CHAR(36)      NULL,                  -- NULL = written by the owner
  author_name      VARCHAR(100)  NOT NULL DEFAULT '',   -- set by the SERVER, never by the phone
  day              CHAR(10)      NOT NULL,              -- the shop's local day
  body             VARCHAR(1000) NOT NULL,
  created_at       DATETIME(3)   NOT NULL,
  updated_at       DATETIME(3)   NOT NULL,
  deleted_at       DATETIME(3)   NULL,                  -- tombstone (owner only)
  server_updated_at DATETIME(3)  NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_pos_notes_sync (user_id, server_updated_at),
  CONSTRAINT fk_pos_notes_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
