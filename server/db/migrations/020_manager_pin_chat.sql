-- ============================================================
-- Migration 020 — «رمز المدير» (undo a sale) + private chat owner ↔ employee
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/020_manager_pin_chat.sql
-- Local dev + test: the same file against daftar_db AND daftar_test.
--
-- 's1:<salt hex>:<sha256(salt + pin) hex>' — set by the shop owner, handed to
-- his staff's phones so the check works OFFLINE at the till. NULL = not set
-- (staff cannot undo a sale until the owner sets one).
-- ============================================================
ALTER TABLE users
  ADD COLUMN pos_manager_pin VARCHAR(160) NULL AFTER pos_report_enabled;

-- One conversation per staff member, between them and the shop owner. Text
-- only; online (no copy kept on the phones). from_staff = 1 when the member
-- wrote it, 0 when the owner did. read_at = when the OTHER side read it.
CREATE TABLE IF NOT EXISTS pos_messages (
  id          CHAR(36)      NOT NULL,
  owner_id    CHAR(36)      NOT NULL,
  staff_id    CHAR(36)      NOT NULL,
  from_staff  TINYINT(1)    NOT NULL,
  body        VARCHAR(1000) NOT NULL,
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  read_at     DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY idx_pos_messages_thread (owner_id, staff_id, created_at),
  CONSTRAINT fk_pos_messages_owner FOREIGN KEY (owner_id) REFERENCES users(id),
  CONSTRAINT fk_pos_messages_staff FOREIGN KEY (staff_id) REFERENCES pos_staff(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
