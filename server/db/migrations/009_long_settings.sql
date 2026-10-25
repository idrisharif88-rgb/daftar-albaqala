-- ============================================================
-- Migration 009 — device preferences sync with the account
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/009_long_settings.sql
-- Local dev + test: the same file against daftar_db AND daftar_test, or
--   sudo bash server/db/local-reset.sh  (reloads both from schema.sql).
--
-- WHY: the accent colour, display size, fingerprint lock and the owner's
-- updates notebook now travel in user_settings, so a reinstall or a new phone
-- gets them back. The notebook is a JSON list of notes — far longer than the
-- 512 characters the column held. The per-key limit is checked in
-- server/src/domain.ts (maxSettingLength), not by the column.
-- ============================================================

ALTER TABLE user_settings MODIFY COLUMN value MEDIUMTEXT NULL;
