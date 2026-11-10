-- ============================================================
-- Migration 014 — POS staff accounts (admin / cashier / adder)
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/014_pos_staff.sql
-- Local dev + test: the same file against daftar_db AND daftar_test.
--
-- A staff member logs in with their OWN phone + password and works on the
-- OWNER's point-of-sale data (owner_id). What each role may push is decided by
-- the server (routes/posSync.ts), never by the app.
--
-- token_version: bumped whenever the role, the password or the disabled flag
-- changes. Every staff token carries the version it was issued with and is
-- checked against this column on every request, so a change takes effect at
-- once — a disabled cashier's 30-day token stops working immediately.
-- ============================================================
CREATE TABLE IF NOT EXISTS pos_staff (
  id             CHAR(36)     NOT NULL,
  owner_id       CHAR(36)     NOT NULL,
  name           VARCHAR(100) NOT NULL,
  phone          VARCHAR(32)  NOT NULL,
  role           ENUM('admin','cashier','adder') NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  token_version  INT          NOT NULL DEFAULT 0,
  disabled_at    DATETIME(3)  NULL,
  created_at     DATETIME(3)  NOT NULL,
  updated_at     DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pos_staff_phone (phone),
  KEY idx_pos_staff_owner (owner_id),
  CONSTRAINT fk_pos_staff_owner FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
