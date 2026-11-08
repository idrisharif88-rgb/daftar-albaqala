-- ============================================================
-- Migration 011 — point-of-sale section, granted per account by the owner
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/011_pos_access.sql
-- Local dev + test: the same file against daftar_db AND daftar_test, or
--   sudo bash server/db/local-reset.sh  (reloads both from schema.sql).
--
-- WHY: the POS section (products, daily baking, scan-to-sell) is an extra the
-- owner switches on for a client from the Watcher. Off for everyone until he
-- does. The flag lives on the account, so it follows the user to a new phone;
-- the shop app reads it from GET /me.
-- ============================================================

ALTER TABLE users
  ADD COLUMN pos_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER drive_backup;
