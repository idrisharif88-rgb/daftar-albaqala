-- ============================================================
-- Migration 017 — per-contact debt limit + automatic reminder
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/017_debt_limit_reminders.sql
-- Local dev + test: the same file against daftar_db AND daftar_test.
--
-- debt_limit: highest debt allowed (riyal), NULL = no limit.
-- reminder_days: automatic SMS reminder every 3/7/14/30 days, NULL = none.
-- reminder_consent: 1 once the shopkeeper records the contact agreed.
-- The SMS itself is sent from the shopkeeper's own phone; the server only
-- keeps these settings so every phone of the account agrees on them.
-- ============================================================
ALTER TABLE customers
  ADD COLUMN debt_limit DECIMAL(12,2) NULL AFTER role,
  ADD COLUMN reminder_days TINYINT UNSIGNED NULL AFTER debt_limit,
  ADD COLUMN reminder_consent TINYINT(1) NOT NULL DEFAULT 0 AFTER reminder_days;
