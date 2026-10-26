-- ============================================================
-- Migration 010 — activation per app: «دفتر المقاول» has its own
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/010_contractor_status.sql
-- Local dev + test: the same file against daftar_db AND daftar_test.
--
-- WHY: one phone + password is one account in both apps, but the owner
-- activates each app separately — a grocer activated for «دفتر البقالة» must
-- not get «دفتر المقاول»'s cloud sync for free, and the other way round.
-- `subscription_status` stays the grocery app's (and 'suspended' there still
-- blocks the whole account); this column is the contractor app's. Every
-- existing account starts NOT activated for it.
-- ============================================================

ALTER TABLE users
  ADD COLUMN contractor_status VARCHAR(16) NOT NULL DEFAULT 'none' AFTER drive_backup;
