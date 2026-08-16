import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from '../asyncHandler';
import { AuthedRequest } from '../middleware/auth';
import {
  DEFAULT_CURRENCY, DEFAULT_ROLE, MAX_SETTING_VALUE_LENGTH, SYNCABLE_SETTING_KEYS,
  VALID_CURRENCIES, VALID_ROLES, VALID_TXN_TYPES,
} from '../domain';

const router = Router();

// All routes behind requireAuth (mounted in app.ts), so req.userId is set.
// SYNC = the phone uploads what it created/changed while offline; the server
// merges it. Two merge rules (see CLAUDE.md):
//   - customers    → upsert by UUID, LAST-WRITE-WINS by updated_at.
//   - transactions → APPEND-ONLY, insert only if the UUID isn't already stored.
// The whole push is IDEMPOTENT: re-sending the same batch changes nothing, so a
// flaky connection can retry safely.
//
// TENANT ISOLATION (#1 risk): a client could send a UUID that belongs to ANOTHER
// owner. We must never read or write across owners, so every record is checked
// against req.userId and any cross-owner id is rejected, never applied.
//
// 🧩 Server concept: acknowledgement. The push reply used to be a set of COUNTS
// («3 inserted, 1 rejected»), which the client could not act on — it had no way
// to tell WHICH row was the rejected one, so it marked all four clean and the
// rejected row was lost forever while the app reported success. A sync protocol
// has to acknowledge rows individually: the sender may only forget a row the
// receiver named. That is why both directions below are keyed by id.

type Row = Record<string, unknown>;

// Why a row was not applied. The client uses this to decide whether retrying is
// worth anything:
//   - invalid          → malformed; retrying sends the same bad row forever.
//   - missing_customer → its contact isn't on the server YET; a later push that
//                        carries the contact will let it through. Retryable.
//   - foreign_owner    → the UUID belongs to another tenant. Never retry.
type RejectReason = 'invalid' | 'missing_customer' | 'foreign_owner';

interface Rejection {
  id: string;
  reason: RejectReason;
}

interface TableResult {
  /** Ids now durably stored server-side — the client may mark these clean. */
  accepted: string[];
  rejected: Rejection[];
}

// A pull page is capped so a first sync on a big book can't build a response
// that the 1GB droplet has to hold in memory all at once (see the RAM note in
// CLAUDE.md). The client follows `has_more` until it's drained.
const PULL_PAGE_SIZE = 500;

// The cursor is rewound by this much before being handed back.
//
// Without it there is a narrow but real hole: `synced_at` is read at the start
// of the request, but a row committed by a CONCURRENT push a millisecond later
// can carry a server_updated_at BELOW that mark and still be invisible to this
// request's snapshot. Next time the client asks for `>= synced_at`, that row is
// already in the past and is never sent. Rewinding makes the next pull overlap
// the gap. Re-pulling a few seconds of rows is free — they apply idempotently —
// whereas missing one row is permanent.
const CURSOR_REWIND_MS = 5000;

// POST /sync/push — body: { customers: [...], transactions: [...], settings: [...] }
// Returns, per table, the ids that were stored and the ids that were not.
// Settings are keyed by name rather than by UUID, so their "id" is the key.
router.post(
  '/push',
  asyncHandler(async (req: AuthedRequest, res) => {
    const customers: Row[] = Array.isArray(req.body?.customers) ? req.body.customers : [];
    const transactions: Row[] = Array.isArray(req.body?.transactions) ? req.body.transactions : [];
    // Absent on APKs older than settings sync — an empty list, not an error.
    const settings: Row[] = Array.isArray(req.body?.settings) ? req.body.settings : [];
    const items: Row[] = Array.isArray(req.body?.items) ? req.body.items : [];

    const result: {
      customers: TableResult;
      transactions: TableResult;
      settings: TableResult;
      items: TableResult;
    } = {
      customers: { accepted: [], rejected: [] },
      transactions: { accepted: [], rejected: [] },
      settings: { accepted: [], rejected: [] },
      items: { accepted: [], rejected: [] },
    };

    // Run the whole batch in one DB transaction: either the merge commits as a
    // unit or it rolls back, so a mid-batch error can't leave a half-synced state.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // ---- customers: upsert, last-write-wins by updated_at ----
      for (const c of customers) {
        const id = c.id ? String(c.id) : '';
        const name = c.name !== undefined && c.name !== null ? String(c.name).trim() : '';
        const phone = c.phone !== undefined && c.phone !== null ? String(c.phone).trim() : '';
        if (!id || !name || !phone) {
          if (id) result.customers.rejected.push({ id, reason: 'invalid' });
          continue;
        }
        const updatedAt = c.updated_at ? new Date(c.updated_at as string) : new Date();
        const createdAt = c.created_at ? new Date(c.created_at as string) : updatedAt;
        if (Number.isNaN(updatedAt.getTime()) || Number.isNaN(createdAt.getTime())) {
          result.customers.rejected.push({ id, reason: 'invalid' });
          continue;
        }
        const note = c.note ?? null;
        const deletedAt = c.deleted_at ? new Date(c.deleted_at as string) : null;
        // An unknown role is not worth rejecting a contact over — the contact
        // and its debts matter, the label doesn't. Fall back to the default.
        const role = VALID_ROLES.has(String(c.role)) ? String(c.role) : DEFAULT_ROLE;

        const [rows] = await conn.query(
          'SELECT user_id, updated_at FROM customers WHERE id = ?',
          [id]
        );
        const existing = (rows as Row[])[0];

        if (!existing) {
          await conn.query(
            `INSERT INTO customers
               (id, user_id, name, phone, note, role, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, req.userId, name, phone, note, role, createdAt, updatedAt, deletedAt]
          );
          result.customers.accepted.push(id);
        } else if (existing.user_id !== req.userId) {
          // UUID belongs to another owner — never touch it.
          result.customers.rejected.push({ id, reason: 'foreign_owner' });
        } else if (updatedAt < new Date(existing.updated_at as string)) {
          // Stale offline edit — the server already has a newer version. The row
          // IS accounted for (the server's copy wins), so the client should stop
          // resending it: that's an accept, not a rejection.
          result.customers.accepted.push(id);
        } else {
          await conn.query(
            `UPDATE customers
               SET name = ?, phone = ?, note = ?, role = ?, updated_at = ?, deleted_at = ?
             WHERE id = ? AND user_id = ?`,
            [name, phone, note, role, updatedAt, deletedAt, id, req.userId]
          );
          result.customers.accepted.push(id);
        }
      }

      // ---- items: upsert, last-write-wins by updated_at ----
      // Merged after contacts (an item points at one) and before transactions,
      // so a contact, its price list and the debts recorded against it can all
      // land in a single push.
      for (const it of items) {
        const id = it.id ? String(it.id) : '';
        const customerId = it.customer_id ? String(it.customer_id) : '';
        const name = it.name !== undefined && it.name !== null ? String(it.name).trim() : '';
        const price = Number(it.price);
        if (!id) continue;
        if (!customerId || !name || !Number.isFinite(price) || price < 0) {
          result.items.rejected.push({ id, reason: 'invalid' });
          continue;
        }
        const currency = it.currency === undefined || it.currency === null
          ? DEFAULT_CURRENCY
          : String(it.currency);
        if (!VALID_CURRENCIES.has(currency)) {
          result.items.rejected.push({ id, reason: 'invalid' });
          continue;
        }
        const updatedAt = it.updated_at ? new Date(it.updated_at as string) : new Date();
        const createdAt = it.created_at ? new Date(it.created_at as string) : updatedAt;
        const deletedAt = it.deleted_at ? new Date(it.deleted_at as string) : null;
        if (Number.isNaN(updatedAt.getTime()) || Number.isNaN(createdAt.getTime())) {
          result.items.rejected.push({ id, reason: 'invalid' });
          continue;
        }

        const [existingRows] = await conn.query(
          'SELECT user_id, updated_at FROM items WHERE id = ?',
          [id]
        );
        const existing = (existingRows as Row[])[0];

        if (existing && existing.user_id !== req.userId) {
          result.items.rejected.push({ id, reason: 'foreign_owner' });
          continue;
        }

        // The contact must be this owner's — same tenant check the FK would
        // only half-enforce (a valid FK to ANOTHER tenant's contact is still a
        // leak).
        const [custRows] = await conn.query(
          'SELECT id FROM customers WHERE id = ? AND user_id = ?',
          [customerId, req.userId]
        );
        if ((custRows as Row[]).length === 0) {
          result.items.rejected.push({ id, reason: 'missing_customer' });
          continue;
        }

        if (!existing) {
          await conn.query(
            `INSERT INTO items
               (id, user_id, customer_id, name, price, currency, note,
                created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, req.userId, customerId, name, price.toFixed(2), currency,
             it.note ?? null, createdAt, updatedAt, deletedAt]
          );
        } else if (updatedAt >= new Date(existing.updated_at as string)) {
          await conn.query(
            `UPDATE items
               SET customer_id = ?, name = ?, price = ?, currency = ?, note = ?,
                   updated_at = ?, deleted_at = ?
             WHERE id = ? AND user_id = ?`,
            [customerId, name, price.toFixed(2), currency, it.note ?? null,
             updatedAt, deletedAt, id, req.userId]
          );
        }
        // Stale edits fall through to an accept: the server's copy won, so the
        // client should stop resending — the row IS accounted for.
        result.items.accepted.push(id);
      }

      // ---- transactions: append-only, insert if the UUID is new ----
      // Processed AFTER customers in the same DB transaction, so a contact and
      // the debts recorded against it can land in a single push.
      for (const t of transactions) {
        const id = t.id ? String(t.id) : '';
        const customerId = t.customer_id ? String(t.customer_id) : '';
        const type = String(t.type);
        const amt = Number(t.amount);
        // A client older than multi-currency only ever meant riyals. An
        // unrecognised code IS rejected: filing gold as riyals corrupts a debt.
        const currency = t.currency === undefined || t.currency === null
          ? DEFAULT_CURRENCY
          : String(t.currency);
        if (!id) continue;
        if (!customerId || !VALID_TXN_TYPES.has(type) || !VALID_CURRENCIES.has(currency) ||
            !Number.isFinite(amt) || amt <= 0) {
          result.transactions.rejected.push({ id, reason: 'invalid' });
          continue;
        }

        // Already stored? Append-only + idempotent → accept without rewriting.
        const [existsRows] = await conn.query(
          'SELECT id FROM transactions WHERE id = ? AND user_id = ?',
          [id, req.userId]
        );
        if ((existsRows as Row[]).length > 0) {
          result.transactions.accepted.push(id);
          continue;
        }

        // The contact must belong to THIS owner (tenant isolation + valid FK).
        const [custRows] = await conn.query(
          'SELECT id FROM customers WHERE id = ? AND user_id = ?',
          [customerId, req.userId]
        );
        if ((custRows as Row[]).length === 0) {
          result.transactions.rejected.push({ id, reason: 'missing_customer' });
          continue;
        }

        const now = new Date();
        const occurredAt = t.occurred_at ? new Date(t.occurred_at as string) : now;
        const createdAt = t.created_at ? new Date(t.created_at as string) : now;
        if (Number.isNaN(occurredAt.getTime()) || Number.isNaN(createdAt.getTime())) {
          result.transactions.rejected.push({ id, reason: 'invalid' });
          continue;
        }
        await conn.query(
          `INSERT INTO transactions
             (id, user_id, customer_id, type, amount, currency, note, occurred_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, req.userId, customerId, type, amt.toFixed(2), currency,
           t.note ?? null, occurredAt, createdAt]
        );
        result.transactions.accepted.push(id);
      }

      // ---- settings: one row per key, last-write-wins by updated_at ----
      //
      // The merge is done by the DATABASE, in a single statement, rather than
      // by reading the row and then deciding. Both of the owner's phones can
      // push the same key at the same moment, and a read-then-write leaves a
      // window between the two halves where the other device's newer value is
      // read as old and overwritten. `ON DUPLICATE KEY UPDATE` evaluates the
      // comparison inside the row lock, so the newer edit wins whichever order
      // the two requests arrive in.
      for (const s of settings) {
        const key = s.key !== undefined && s.key !== null ? String(s.key) : '';
        if (!key) continue;
        const value = s.value === undefined || s.value === null ? null : String(s.value);
        const updatedAt = s.updated_at ? new Date(s.updated_at as string) : new Date();
        if (!SYNCABLE_SETTING_KEYS.has(key) ||
            Number.isNaN(updatedAt.getTime()) ||
            (value !== null && value.length > MAX_SETTING_VALUE_LENGTH)) {
          result.settings.rejected.push({ id: key, reason: 'invalid' });
          continue;
        }

        await conn.query(
          `INSERT INTO user_settings (user_id, \`key\`, value, updated_at)
           VALUES (?, ?, ?, ?) AS incoming
           ON DUPLICATE KEY UPDATE
             value      = IF(incoming.updated_at >= user_settings.updated_at,
                             incoming.value, user_settings.value),
             updated_at = GREATEST(user_settings.updated_at, incoming.updated_at)`,
          [req.userId, key, value, updatedAt]
        );
        // Accepted either way: if the stored copy was newer it simply won, and
        // the client should stop resending — the key IS accounted for.
        result.settings.accepted.push(key);
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    return res.json(result);
  })
);

// ---- The pull cursor ----
//
// A timestamp alone is not a safe cursor. Rows can share a millisecond, and if
// more rows share one than fit in a page, a timestamp cursor stops advancing
// and the client loops on the same page forever — which is exactly what a bulk
// import or a migration produces, since those stamp everything at once.
//
// So the cursor is a KEYSET: the (server_updated_at, id) of the last row
// delivered from each table. (ts, id) is unique and totally ordered, so "give
// me what comes after this" always makes progress. It is passed as one opaque
// string because the client's job is to store it, not to understand it.
interface TableCursor {
  ts: Date;
  id: string;
}
interface PullCursor {
  customers: TableCursor;
  transactions: TableCursor;
  items: TableCursor;
}

const CURSOR_VERSION = 'v1';
// v2 adds the items table. The version is part of the string so an old cursor
// is RECOGNISED rather than mis-parsed: a v1 cursor has no items position, and
// guessing one would either replay the whole list or skip it entirely.
const CURSOR_VERSION_V2 = 'v2';
const EPOCH = () => new Date(0);

function encodeCursor(c: PullCursor): string {
  return [
    CURSOR_VERSION_V2,
    c.customers.ts.toISOString(), c.customers.id,
    c.transactions.ts.toISOString(), c.transactions.id,
    c.items.ts.toISOString(), c.items.id,
  ].join('|');
}

// Accepts the v2 keyset form, the v1 form (no items), or a bare ISO timestamp —
// the format the oldest installed APKs still send. Returns null if it is none.
function decodeCursor(raw: string | undefined): PullCursor | null {
  const fresh = (): TableCursor => ({ ts: EPOCH(), id: '' });
  if (!raw) return { customers: fresh(), transactions: fresh(), items: fresh() };

  if (raw.startsWith(`${CURSOR_VERSION_V2}|`)) {
    const [, cts, cid, tts, tid, its, iid] = raw.split('|');
    const customersTs = new Date(cts);
    const transactionsTs = new Date(tts);
    const itemsTs = new Date(its);
    if (Number.isNaN(customersTs.getTime()) || Number.isNaN(transactionsTs.getTime()) ||
        Number.isNaN(itemsTs.getTime())) {
      return null;
    }
    return {
      customers: { ts: customersTs, id: cid ?? '' },
      transactions: { ts: transactionsTs, id: tid ?? '' },
      items: { ts: itemsTs, id: iid ?? '' },
    };
  }

  if (raw.startsWith(`${CURSOR_VERSION}|`)) {
    const [, cts, cid, tts, tid] = raw.split('|');
    const customersTs = new Date(cts);
    const transactionsTs = new Date(tts);
    if (Number.isNaN(customersTs.getTime()) || Number.isNaN(transactionsTs.getTime())) return null;
    return {
      customers: { ts: customersTs, id: cid ?? '' },
      transactions: { ts: transactionsTs, id: tid ?? '' },
      // A client upgrading from v1 has never pulled an item, so it starts from
      // the beginning of that table rather than from the contacts' position.
      items: fresh(),
    };
  }

  const ts = new Date(raw);
  if (Number.isNaN(ts.getTime())) return null;
  // Legacy clients sent a plain timestamp and expected `>=` semantics.
  return { customers: { ts, id: '' }, transactions: { ts, id: '' }, items: fresh() };
}

// mysql2 hands DATETIME back as a Date, but a raw function result can arrive as
// a string depending on driver settings — accept both rather than guess.
function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

// GET /sync/pull?since=<cursor>&limit=<n> — everything the server has written
// since the client's last sync, so a second device / reinstall catches up.
//
//   - customers    → INCLUDES soft-deleted rows (tombstones) so deletes
//                    propagate; the client reads deleted_at to apply them.
//   - transactions → append-only, never change after insert.
//
// Both filter on `server_updated_at`, the column MySQL stamps itself. They used
// to filter on created_at / updated_at, which come from the PHONE — a device
// with a wrong clock (routine on cheap Androids) writes a row dated last year,
// and every other device's cursor is already past it, so that debt is never
// delivered. A delta cursor may only be compared against a clock the server
// controls.
router.get(
  '/pull',
  asyncHandler(async (req: AuthedRequest, res) => {
    const sinceParam = typeof req.query.since === 'string' ? req.query.since : undefined;
    const cursor = decodeCursor(sinceParam);
    if (!cursor) {
      return res.status(400).json({ error: 'since must be a valid cursor or ISO timestamp' });
    }

    const limitParam = Number(req.query.limit);
    const limit = Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(Math.floor(limitParam), PULL_PAGE_SIZE)
      : PULL_PAGE_SIZE;

    // Read the clock from MySQL, not from Node: the timestamps we compare it
    // against are written by MySQL, and even a second of drift between the two
    // machines would shift the cursor off the data it is meant to track.
    const [clockRows] = await pool.query('SELECT NOW(3) AS now');
    const serverNow = asDate((clockRows as Row[])[0].now);

    // Keyset predicate: strictly after (ts, id) in that order.
    const after = '(server_updated_at > ? OR (server_updated_at = ? AND id > ?))';

    // Fetch one extra row to detect a further page without a second COUNT query.
    const [customerRows] = await pool.query(
      `SELECT id, name, phone, note, role, created_at, updated_at, deleted_at, server_updated_at
         FROM customers
        WHERE user_id = ? AND ${after}
        ORDER BY server_updated_at ASC, id ASC
        LIMIT ?`,
      [req.userId, cursor.customers.ts, cursor.customers.ts, cursor.customers.id, limit + 1]
    );
    const [transactionRows] = await pool.query(
      `SELECT id, customer_id, type, amount, currency, note, occurred_at, created_at, server_updated_at
         FROM transactions
        WHERE user_id = ? AND ${after}
        ORDER BY server_updated_at ASC, id ASC
        LIMIT ?`,
      [req.userId, cursor.transactions.ts, cursor.transactions.ts, cursor.transactions.id, limit + 1]
    );
    // Items INCLUDE soft-deleted rows, same as contacts — a removal has to
    // reach the other device, or the item reappears on its next pull.
    const [itemRows] = await pool.query(
      `SELECT id, customer_id, name, price, currency, note,
              created_at, updated_at, deleted_at, server_updated_at
         FROM items
        WHERE user_id = ? AND ${after}
        ORDER BY server_updated_at ASC, id ASC
        LIMIT ?`,
      [req.userId, cursor.items.ts, cursor.items.ts, cursor.items.id, limit + 1]
    );

    // Settings ride along OUTSIDE the keyset cursor: the whole set is returned
    // on every pull, page or no page. It is a dozen short strings, so there is
    // nothing to page, and sending them unconditionally means a device that
    // somehow missed an update repairs itself on the very next sync instead of
    // waiting for the key to change again.
    const [settingRows] = await pool.query(
      'SELECT `key`, value, updated_at FROM user_settings WHERE user_id = ? ORDER BY `key`',
      [req.userId]
    );

    const allCustomers = customerRows as Row[];
    const allTransactions = transactionRows as Row[];
    const allItems = itemRows as Row[];
    const moreCustomers = allCustomers.length > limit;
    const moreTransactions = allTransactions.length > limit;
    const moreItems = allItems.length > limit;
    const customers = moreCustomers ? allCustomers.slice(0, limit) : allCustomers;
    const transactions = moreTransactions ? allTransactions.slice(0, limit) : allTransactions;
    const items = moreItems ? allItems.slice(0, limit) : allItems;
    const hasMore = moreCustomers || moreTransactions || moreItems;

    // Advance each table's cursor to its own last delivered row.
    const advance = (rows: Row[], previous: TableCursor): TableCursor => {
      const last = rows[rows.length - 1];
      if (!last) return previous;
      return { ts: asDate(last.server_updated_at), id: String(last.id) };
    };
    let next: PullCursor = {
      customers: advance(customers, cursor.customers),
      transactions: advance(transactions, cursor.transactions),
      items: advance(items, cursor.items),
    };

    // Once fully drained, rewind to a moment safely in the past.
    //
    // Otherwise there is a narrow but real hole: a row committed by a CONCURRENT
    // push after this request took its snapshot can carry a server_updated_at
    // BELOW the point we just advanced to, and would never be sent again.
    // Rewinding makes the next pull overlap that gap. Re-pulling a few seconds
    // of rows is free — the client applies them idempotently — whereas missing
    // one row is permanent.
    if (!hasMore) {
      const safe = { ts: new Date(serverNow.getTime() - CURSOR_REWIND_MS), id: '' };
      next = { customers: safe, transactions: { ...safe }, items: { ...safe } };
    }

    return res.json({
      customers,
      transactions,
      items,
      settings: settingRows as Row[],
      synced_at: encodeCursor(next),
      has_more: hasMore,
    });
  })
);

export default router;
