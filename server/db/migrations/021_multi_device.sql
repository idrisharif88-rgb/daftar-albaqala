-- ============================================================
-- Migration 021 — «عدة أجهزة»: one account, several phones, each entry
-- says who recorded it.
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/021_multi_device.sql
-- Local dev + test: the same file against daftar_db AND daftar_test.
--
-- users.multi_device: switched on per account by the developer (Watcher).
-- transactions.recorded_by: «<name> · <last 3 digits>» of the person using the
-- phone that recorded it. NULL = an older app, or the switch off.
-- ============================================================
ALTER TABLE users
  ADD COLUMN multi_device TINYINT(1) NOT NULL DEFAULT 0 AFTER pos_manager_pin;

ALTER TABLE transactions
  ADD COLUMN recorded_by VARCHAR(80) NULL AFTER note;
