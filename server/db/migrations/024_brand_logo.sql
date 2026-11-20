-- ============================================================
-- Migration 024 — a shop's own logo («شعار المتجر»).
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/024_brand_logo.sql
-- Local dev + test: the same file against daftar_db AND daftar_test.
--
-- Set by the developer from the Watcher; the shop's app shows it on Home in
-- place of the letter badge. Stored as a small data URL (the Watcher shrinks
-- the image to ≤ 256 px first). brand_logo_at tells the app when to re-fetch.
-- ============================================================
ALTER TABLE users
  ADD COLUMN brand_logo    MEDIUMTEXT NULL AFTER activated_at,
  ADD COLUMN brand_logo_at DATETIME(3) NULL AFTER brand_logo;
