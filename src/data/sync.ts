import { getDB, persist } from './db';
import { fromMinor, toMinor } from './money';
import {
  getDirtyCustomers, markCustomersSynced, applyServerCustomer,
} from './customers';
import {
  getDirtyTransactions, markTransactionsSynced, applyServerTransaction, type TxnType,
} from './transactions';
import { syncPush, syncPull, ApiError } from '../lib/api';

// Sync engine — reconciles the local SQLite store with the cloud (server's
// daftar_db) over /sync/push + /sync/pull. Offline-first: this is best-effort
// and never throws to the UI; it reports an outcome the caller can show.
//
// Push: send rows with synced = 0, then mark them clean. Pull: ask for everything
// changed since our cursor, apply it (LWW for customers, insert-if-new for
// transactions), and advance the cursor to the server clock it returns. Both
// directions are idempotent, so a retry after a drop is safe.
//
// Money crosses the wire in MAJOR units (server DECIMAL) but is stored locally in
// INTEGER minor units — converted here (fromMinor on push, toMinor on pull).

const CURSOR_KEY = 'sync_since';

export type SyncStatus = 'ok' | 'offline' | 'subscription' | 'error';
export interface SyncOutcome {
  status: SyncStatus;
  pushed?: number;
  pulled?: number;
}

async function getCursor(): Promise<string | null> {
  const db = await getDB();
  const res = await db.query(`SELECT value FROM app_meta WHERE key = ?`, [CURSOR_KEY]);
  return ((res.values ?? [])[0]?.value as string) ?? null;
}

async function setCursor(value: string): Promise<void> {
  const db = await getDB();
  await db.run(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [CURSOR_KEY, value]
  );
}

// Only one sync at a time — concurrent runs (manual tap during an auto-sync)
// share the in-flight promise instead of racing the same rows.
let inFlight: Promise<SyncOutcome> | null = null;

export function runSync(): Promise<SyncOutcome> {
  if (inFlight) return inFlight;
  inFlight = doSync().finally(() => { inFlight = null; });
  return inFlight;
}

async function doSync(): Promise<SyncOutcome> {
  try {
    // ---- 1. push local changes ----
    const dirtyCustomers = await getDirtyCustomers();
    const dirtyTxns = await getDirtyTransactions();

    await syncPush({
      customers: dirtyCustomers.map((c) => ({
        id: c.id, name: c.name, phone: c.phone, note: c.note,
        created_at: c.created_at, updated_at: c.updated_at, deleted_at: c.deleted_at,
      })),
      transactions: dirtyTxns.map((t) => ({
        id: t.id, customer_id: t.customer_id, type: t.type,
        amount: fromMinor(t.amount), // minor → major for the server's DECIMAL
        note: t.note, occurred_at: t.occurred_at, created_at: t.created_at,
      })),
    });

    await markCustomersSynced(dirtyCustomers.map((c) => ({ id: c.id, updated_at: c.updated_at })));
    await markTransactionsSynced(dirtyTxns.map((t) => t.id));

    // ---- 2. pull server deltas ----
    const since = await getCursor();
    const pull = await syncPull(since);

    for (const c of pull.customers) {
      await applyServerCustomer({
        id: c.id, name: c.name, phone: c.phone, note: c.note,
        created_at: c.created_at, updated_at: c.updated_at, deleted_at: c.deleted_at,
      });
    }
    for (const t of pull.transactions) {
      await applyServerTransaction({
        id: t.id, customer_id: t.customer_id, type: t.type as TxnType,
        amount: toMinor(Number(t.amount)), // major → minor for local storage
        note: t.note, occurred_at: t.occurred_at, created_at: t.created_at,
      });
    }
    await setCursor(pull.synced_at);
    await persist();

    return {
      status: 'ok',
      pushed: dirtyCustomers.length + dirtyTxns.length,
      pulled: pull.customers.length + pull.transactions.length,
    };
  } catch (err) {
    await persist().catch(() => {}); // keep whatever did land
    if (err instanceof ApiError) {
      if (err.status === 402) return { status: 'subscription' };
      if (err.status === 0) return { status: 'offline' };
    }
    console.warn('sync failed', err);
    return { status: 'error' };
  }
}
