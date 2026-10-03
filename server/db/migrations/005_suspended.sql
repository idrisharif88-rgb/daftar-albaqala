-- ============================================================
-- Migration 005 — a 'suspended' account status (the Watcher app)
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/005_suspended.sql
--
-- WHY: the owner can now suspend an account from the Watcher app. A suspended
-- account cannot log in and cannot sync. It is a status of its own, not
-- 'none' or 'expired', so the owner can tell "never activated" from "stopped
-- by me" — and so reactivating it is a deliberate act.
--
-- Adding a value to the END of an ENUM keeps every existing row's value.
-- ============================================================

ALTER TABLE users
  MODIFY subscription_status ENUM('none','active','expired','suspended') NOT NULL DEFAULT 'none';
