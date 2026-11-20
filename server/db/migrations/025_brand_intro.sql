-- ============================================================
-- Migration 025 — the shop's intro picture («صورة الترحيب»).
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/025_brand_intro.sql
-- Local dev + test: the same file against daftar_db AND daftar_test.
--
-- A bigger picture (the shop's whole card) played full-screen ONCE after
-- sign-in, then the book opens. The small logo (024) stays the Home badge.
-- The Watcher shrinks it to ≤ 720 px first.
-- ============================================================
ALTER TABLE users
  ADD COLUMN brand_intro    MEDIUMTEXT NULL AFTER brand_logo_at,
  ADD COLUMN brand_intro_at DATETIME(3) NULL AFTER brand_intro;
