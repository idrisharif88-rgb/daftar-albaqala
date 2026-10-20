-- ============================================================
-- Migration 006 — the owner can delete an entry (the Watcher app)
--
-- Run as ROOT on the droplet (daftar_user has DML only):
--   sudo mysql -u root -p daftar_db < server/db/migrations/006_transaction_delete.sql
--
-- WHY: entries were append-only, corrected only by a reversing entry. The
-- owner now deletes a wrong entry outright from the Watcher. It is a TOMBSTONE,
-- not a DELETE: a row that vanishes from the server can never tell the phones
-- that hold a copy, so they would keep showing it. A deleted_at row travels on
-- the next pull (to an app new enough to understand it) and the phone drops it.
--
-- server_updated_at gains ON UPDATE so a deletion moves the row forward in the
-- delta cursor, the same way it already does on customers.
-- ============================================================

ALTER TABLE transactions
  ADD COLUMN deleted_at DATETIME NULL AFTER created_at,
  MODIFY server_updated_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
