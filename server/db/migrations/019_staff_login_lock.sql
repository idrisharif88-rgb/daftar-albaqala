-- ============================================================
-- Migration 019 — staff login lock
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/019_staff_login_lock.sql
-- Local dev + test: the same file against daftar_db AND daftar_test.
--
-- 4 wrong passwords in a row lock the staff member's login until the shop
-- owner sets a new password («الموظفون»). A right password resets the count.
-- ============================================================
-- Also: POS notes can be EDITED — by their author, or by the shop owner.
-- edited_at = when the text was last changed, on the editor's clock (the
-- last edit wins); NULL = never edited.
ALTER TABLE pos_notes
  ADD COLUMN edited_at DATETIME(3) NULL AFTER body;

ALTER TABLE pos_staff
  ADD COLUMN failed_logins TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER token_version,
  ADD COLUMN locked_at DATETIME(3) NULL AFTER failed_logins;
