-- ============================================================
-- Migration 002 — per-account settings (user_settings)
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/002_user_settings.sql
-- Local dev + test: sudo bash server/db/local-reset.sh reloads both DBs
-- from schema.sql instead.
--
-- WHY: the store name, the owner's name and the exchange rates lived only in
-- the phone's app_meta. Reinstall the app, or sign in on a second device, and
-- they were gone — the notifications went out unsigned and every foreign-currency
-- debt lost its riyal reference until the owner retyped the rates. They belong
-- to the ACCOUNT, so they sync like everything else: one row per key, last write
-- wins by updated_at.
--
-- Idempotent: safe to run twice.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_settings (
  user_id     CHAR(36)     NOT NULL,
  `key`       VARCHAR(64)  NOT NULL,
  value       VARCHAR(512) NULL,
  updated_at  DATETIME     NOT NULL,
  server_updated_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, `key`),
  CONSTRAINT fk_settings_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
