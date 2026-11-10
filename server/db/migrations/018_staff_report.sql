-- ============================================================
-- Migration 018 — the owner's report per cashier
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/018_staff_report.sql
-- Local dev + test: the same file against daftar_db AND daftar_test.
--
-- pos_sales.staff_id: who made the sale, set by the SERVER from the token
--   (NULL = the owner, or a sale older than this migration).
-- pos_staff_sessions: one row per staff sign-in; logout_at stays NULL until
--   the member signs out from the app.
-- ============================================================
ALTER TABLE pos_sales
  ADD COLUMN staff_id CHAR(36) NULL AFTER user_id,
  ADD KEY idx_pos_sales_staff (user_id, staff_id, day);

CREATE TABLE IF NOT EXISTS pos_staff_sessions (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_id   CHAR(36)    NOT NULL,
  staff_id   CHAR(36)    NOT NULL,
  login_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  logout_at  DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_pos_sessions_staff (owner_id, staff_id, login_at),
  CONSTRAINT fk_pos_sessions_owner FOREIGN KEY (owner_id) REFERENCES users(id),
  CONSTRAINT fk_pos_sessions_staff FOREIGN KEY (staff_id) REFERENCES pos_staff(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
