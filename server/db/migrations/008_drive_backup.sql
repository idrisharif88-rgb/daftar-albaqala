-- ============================================================
-- Migration 008 — Google Drive backup, granted per account by the owner
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/008_drive_backup.sql
-- Local dev + test: the same file against daftar_db AND daftar_test, or
--   sudo bash server/db/local-reset.sh  (reloads both from schema.sql).
--
-- WHY: backing the book up to the grocer's own Google Drive is an extra the
-- owner hands out (and may charge for) from the Watcher app. Off for everyone
-- until he turns it on. The flag lives on the account, so it follows the
-- grocer to a new phone; the shop app reads it from GET /me.
-- ============================================================

ALTER TABLE users
  ADD COLUMN drive_backup TINYINT(1) NOT NULL DEFAULT 0 AFTER subscription_expires_at;
