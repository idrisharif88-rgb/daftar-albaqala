-- ============================================================
-- Migration 015 — POS staff: developer switch + per-person permissions
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/015_pos_staff_permissions.sql
-- Local dev + test: the same file against daftar_db AND daftar_test.
--
-- users.pos_staff_enabled — staff accounts are an extra the DEVELOPER switches
--   on per account (Watcher). Off = the owner never sees «الموظفون», and every
--   staff login and staff token of that shop is refused by the server.
-- pos_staff.permissions — a JSON array of permission codes
--   (server/src/pos/permissions.ts). The role is now only the PRESET a member
--   started from; what they may do is this list, which can be changed later.
-- ============================================================
ALTER TABLE users
  ADD COLUMN pos_staff_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER pos_enabled;

ALTER TABLE pos_staff
  ADD COLUMN permissions VARCHAR(500) NOT NULL DEFAULT '[]' AFTER role;

-- Existing members keep exactly what their role allowed before.
UPDATE pos_staff SET permissions = '["sell","add_stock","see_stock","see_reports","manage_products","submit_day","manage_staff"]' WHERE role = 'admin';
UPDATE pos_staff SET permissions = '["sell"]' WHERE role = 'cashier';
UPDATE pos_staff SET permissions = '["add_stock","see_stock","see_reports"]' WHERE role = 'adder';
