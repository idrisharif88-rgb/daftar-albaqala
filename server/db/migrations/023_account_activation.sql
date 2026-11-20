-- ============================================================
-- Migration 023 — account activation, separate from server sync.
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/023_account_activation.sql
-- Local dev + test: the same file against daftar_db AND daftar_test.
--
-- users.activated_at: the developer approved this account (Watcher «تفعيل»),
-- which needs a verified number (022). Server sync is its own switch and
-- can only be turned on for an activated account. A new account starts NULL.
-- Every account that exists today counts as activated (nothing changes for them).
-- ============================================================
ALTER TABLE users
  ADD COLUMN activated_at DATETIME NULL AFTER verify_attempts;

UPDATE users SET activated_at = created_at WHERE activated_at IS NULL;
