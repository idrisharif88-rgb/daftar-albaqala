-- ============================================================
-- Migration 022 — phone verification («رمز التحقق»).
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/022_phone_verification.sql
-- Local dev + test: the same file against daftar_db AND daftar_test.
--
-- The developer generates a 6-digit code in the Watcher and sends it to the
-- number (WhatsApp / SMS); the user types it into the app. Only its SHA-256
-- is stored, it dies after 10 minutes, and 5 wrong tries spend it.
-- Server sync cannot be switched on for an unverified number.
--
-- Every account that exists today is treated as verified (owner's decision,
-- 2026-11-20): nothing changes for current users.
-- ============================================================
ALTER TABLE users
  ADD COLUMN phone_verified_at      DATETIME         NULL AFTER multi_device,
  ADD COLUMN verify_code_hash       CHAR(64)         NULL AFTER phone_verified_at,
  ADD COLUMN verify_code_expires_at DATETIME         NULL AFTER verify_code_hash,
  ADD COLUMN verify_attempts        TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER verify_code_expires_at;

UPDATE users SET phone_verified_at = created_at WHERE phone_verified_at IS NULL;
