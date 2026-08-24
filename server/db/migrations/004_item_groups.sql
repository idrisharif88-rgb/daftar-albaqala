-- ============================================================
-- Migration 004 — saved baskets (item_groups)
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/004_item_groups.sql
-- Local dev + test: sudo bash server/db/local-reset.sh reloads both DBs
-- from schema.sql instead.
--
-- WHY: the owner buys the same handful of things from the same shop every
-- week. The price list already turned each of those into one tap; a group
-- turns the whole basket into one tap. It belongs to the ACCOUNT, not to one
-- phone — a group rebuilt after every reinstall is a group nobody keeps — so
-- it syncs exactly like items do: upsert by UUID, last-write-wins by
-- updated_at, soft-delete via deleted_at.
--
-- `lines_json` holds the membership: [{"item_id":"…","qty":3}, …].
-- NOT named `lines`: that is a RESERVED word in MySQL (LOAD DATA … LINES TERMINATED BY),
-- so the CREATE fails outright. Backticking it in every query would work and would also be
-- one forgotten backtick away from breaking again.
--
-- Why a text column and not a join table: the server never reads inside it.
-- A group is meaningless without the price list it points at, and that list is
-- already scoped to one contact of one owner, so the client resolves the ids
-- against its own rows and skips anything that no longer exists. A join table
-- would add a second synced entity — with its own tombstones, its own ordering
-- against the parent, and its own way to arrive half-applied — to store a
-- handful of ids that only ever move together.
--
-- Idempotent: safe to run twice.
-- ============================================================

CREATE TABLE IF NOT EXISTS item_groups (
  id           CHAR(36)      NOT NULL,
  user_id      CHAR(36)      NOT NULL,
  customer_id  CHAR(36)      NOT NULL,
  name         VARCHAR(128)  NOT NULL,
  lines_json   TEXT          NOT NULL,
  created_at   DATETIME      NOT NULL,
  updated_at   DATETIME      NOT NULL,
  deleted_at   DATETIME      NULL,

  server_updated_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  CONSTRAINT fk_group_user FOREIGN KEY (user_id)     REFERENCES users(id),
  CONSTRAINT fk_group_cust FOREIGN KEY (customer_id) REFERENCES customers(id),
  KEY idx_group_user_cust (user_id, customer_id),
  KEY idx_group_sync (user_id, server_updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
