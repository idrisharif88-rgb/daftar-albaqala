-- ============================================================
-- Migration 026 — account type: grocery | club («دفتر النادي», Phase 43).
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/026_account_type.sql
-- Local dev + test: the same file against daftar_db AND daftar_test.
--
-- users.account_type: which section the app opens for this account. Only the
-- developer changes it (Watcher). Every existing account stays 'grocery', so
-- nothing changes for current users.
-- ============================================================
ALTER TABLE users
  ADD COLUMN account_type VARCHAR(16) NOT NULL DEFAULT 'grocery' AFTER brand_intro_at;
