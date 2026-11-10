-- ============================================================
-- Migration 013 — POS products: daily vs carry-over stock
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/013_pos_non_daily.sql
-- Local dev + test: the same file against daftar_db AND daftar_test.
--
-- daily = 1 (default): baked fresh each day. daily = 0: stock that carries
-- over (vinegar, honey, ghee) — its quantity is a running total across days.
-- ============================================================
ALTER TABLE pos_products
  ADD COLUMN daily TINYINT(1) NOT NULL DEFAULT 1 AFTER price;
