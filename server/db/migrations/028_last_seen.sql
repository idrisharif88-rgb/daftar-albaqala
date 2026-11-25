-- ============================================================
-- Migration 028 — «آخر نشاط» in the Watcher = the last time the account
-- used the app (any signed-in request or a login), not the last row it wrote.
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/028_last_seen.sql
-- Local dev + test: the same file against daftar_db AND daftar_test.
--
-- Stamped by requireAuth (at most once a minute per account) and by
-- POST /auth/login. NULL = not seen since this migration.
-- ============================================================
ALTER TABLE users
  ADD COLUMN last_seen_at DATETIME(3) NULL AFTER account_type;
