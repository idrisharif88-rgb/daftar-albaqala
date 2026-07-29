import { persist } from './db';
import { getMeta, setMetaRaw } from './meta';
import { fromMinor, toMinor } from './money';
import { BASE_CURRENCY, isCurrencyCode } from './currencies';
import {
  getDirtyCustomers, markCustomersSynced, applyServerCustomer, type Customer,
} from './customers';
import {
  getDirtyTransactions, markTransactionsSynced, applyServerTransaction,
  type TxnType, type Transaction,
} from './transactions';
import {
  syncPush, syncPull, ApiError,
  type PushCustomer, type PushTransaction, type TableAck,
} from '../lib/api';
import { setAccountActive } from './account';

// Sync engine — reconciles the local SQLite store with the cloud (server's
// daftar_db) over /sync/push + /sync/pull. Offline-first: this is best-effort
// and never throws to the UI; it reports an outcome the caller can show.
//
// THE RULE THAT MATTERS: a local row may only be marked clean when the server
// has NAMED it as stored. The first version of this file marked every pushed
// row clean the moment the request came back 200, and the server's reply was
// only a set of counts — so a row the server refused was forgotten locally,
// never retried, and the app still said «تمت المزامنة». That is silent data
// loss, the worst failure a ledger can have: the grocer sees the debt on the
// phone, it does not exist in the cloud, and a reinstall erases it. The server
// now acknowledges rows individually and we honour exactly that list.
//
// Money crosses the wire in MAJOR units (server DECIMAL) but is stored locally
// in INTEGER minor units — converted here (fromMinor on push, toMinor on pull).
// The CURRENCY travels alongside: it is part of the debt, not a display choice.

const CURSOR_KEY = 'sync_since';
const LAST_OK_KEY = 'sync_last_ok_at';
const LAST_STATUS_KEY = 'sync_last_status';
const UNSYNCED_KEY = 'sync_unsynced_count';

// Rows per request. Sized so a chunk stays well under the server's 2 MB body
// limit, and so a dropped connection costs one chunk rather than the whole
// backlog — each chunk that succeeds is durable on its own.
const PUSH_CHUNK = 200;
// Rows per pull page; the server caps this at 500 regardless.
const PULL_PAGE = 500;
// Stop after this many pages. A pull loop that never drains means the cursor
// is not advancing (a server bug); better to end the run and let the warning
// indicator show than to spin the radio flat.
const MAX_PULL_PAGES = 100;

export type SyncStatus = 'ok' | 'offline' | 'subscription' | 'error' | 'partial';

export interface SyncOutcome {
  status: SyncStatus;
  pushed?: number;
  pulled?: number;
  /** Rows the server would not take. Non-zero means the book is not fully
   *  backed up, even if everything else worked — surfaced as a warning. */
  rejected?: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---- Wire mapping ----

function toPushCustomer(c: Customer): PushCustomer {
  return {
    id: c.id, name: c.name, phone: c.phone, note: c.note, role: c.role,
    created_at: c.created_at, updated_at: c.updated_at, deleted_at: c.deleted_at,
  };
}

function toPushTransaction(t: Transaction): PushTransaction {
  return {
    id: t.id, customer_id: t.customer_id, type: t.type,
    amount: fromMinor(t.amount), // minor → major for the server's DECIMAL
    currency: t.currency,
    note: t.note, occurred_at: t.occurred_at, created_at: t.created_at,
  };
}

// ---- Cursor ----

async function getCursor(): Promise<string | null> {
  return getMeta(CURSOR_KEY);
}

async function setCursor(value: string): Promise<void> {
  await setMetaRaw(CURSOR_KEY, value);
}

// ---- Status, for the warning indicator ----

export interface SyncHealth {
  /** Outcome of the last completed run. */
  status: SyncStatus | null;
  /** When sync last completed cleanly, ISO — null if it never has. */
  lastOkAt: string | null;
  /** Local rows still not stored in the cloud. */
  unsynced: number;
}

export async function getSyncHealth(): Promise<SyncHealth> {
  const [status, lastOkAt, unsynced] = await Promise.all([
    getMeta(LAST_STATUS_KEY),
    getMeta(LAST_OK_KEY),
    getMeta(UNSYNCED_KEY),
  ]);
  return {
    status: status ? (status as SyncStatus) : null,
    lastOkAt,
    unsynced: Number(unsynced ?? 0) || 0,
  };
}

/** True when the user should see the warning triangle: the last run did not
 *  fully succeed. 'offline' counts — an offline-first app still needs to say
 *  "this is not backed up yet". */
export function needsAttention(health: SyncHealth): boolean {
  return health.status !== null && health.status !== 'ok';
}

async function recordOutcome(outcome: SyncOutcome, unsynced: number): Promise<void> {
  await setMetaRaw(LAST_STATUS_KEY, outcome.status);
  await setMetaRaw(UNSYNCED_KEY, String(unsynced));
  if (outcome.status === 'ok') await setMetaRaw(LAST_OK_KEY, new Date().toISOString());
  await persist();
}

// ---- The run ----

// Screens subscribe so they can refresh when a sync finishes. Without this the
// auto-sync that runs at app open pulls new data into SQLite while the list is
// already on screen showing the old rows, and nothing tells it to look again.
type SyncListener = (outcome: SyncOutcome) => void;
const listeners = new Set<SyncListener>();

/** Subscribe to sync completions. Returns an unsubscribe function. */
export function onSyncComplete(listener: SyncListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(outcome: SyncOutcome): void {
  for (const listener of listeners) {
    // One bad subscriber must not break the others, or the sync itself.
    try { listener(outcome); } catch (err) { console.warn('sync listener failed', err); }
  }
}

// Only one sync at a time — concurrent runs (manual tap during an auto-sync)
// share the in-flight promise instead of racing the same rows.
let inFlight: Promise<SyncOutcome> | null = null;

export function runSync(): Promise<SyncOutcome> {
  if (inFlight) return inFlight;
  inFlight = doSync()
    .then((outcome) => { emit(outcome); return outcome; })
    .finally(() => { inFlight = null; });
  return inFlight;
}

/**
 * Push one table's worth of rows, in chunks, and report what the server took.
 * Chunks are independent: an early failure keeps the chunks already accepted,
 * because each was acknowledged and marked clean before the next was sent.
 */
async function pushChunks<T>(
  rows: T[],
  build: (batch: T[]) => { customers: PushCustomer[]; transactions: PushTransaction[] },
  pick: (result: { customers: TableAck; transactions: TableAck }) => TableAck,
  markClean: (accepted: Set<string>, batch: T[]) => Promise<void>,
): Promise<{ accepted: number; rejected: number }> {
  let accepted = 0;
  let rejected = 0;
  for (const batch of chunk(rows, PUSH_CHUNK)) {
    const result = await syncPush(build(batch));
    const ack = pick(result);
    const acceptedIds = new Set(ack.accepted);
    await markClean(acceptedIds, batch);
    accepted += acceptedIds.size;
    rejected += ack.rejected.length;
    if (ack.rejected.length > 0) {
      // Not fatal — the rows stay dirty and go again next run — but it must be
      // visible, because "synced" would otherwise be a lie.
      console.warn('sync: server rejected rows', ack.rejected);
    }
  }
  return { accepted, rejected };
}

async function doSync(): Promise<SyncOutcome> {
  let dirtyCustomers: Customer[] = [];
  let dirtyTxns: Transaction[] = [];
  try {
    dirtyCustomers = await getDirtyCustomers();
    dirtyTxns = await getDirtyTransactions();

    // ---- 1. push contacts FIRST, and only then their transactions ----
    // A transaction is refused if its contact isn't on the server yet, so the
    // order is not cosmetic. Within one request the server already does
    // contacts first; doing it across requests too means a contact accepted in
    // an early chunk is available to a transaction in a later one.
    const custResult = await pushChunks(
      dirtyCustomers,
      (batch) => ({ customers: batch.map(toPushCustomer), transactions: [] }),
      (r) => r.customers,
      async (acceptedIds, batch) => {
        // Guarded by updated_at inside markCustomersSynced: a row edited again
        // *during* the push stays dirty rather than being wrongly cleared.
        await markCustomersSynced(
          batch.filter((c) => acceptedIds.has(c.id))
            .map((c) => ({ id: c.id, updated_at: c.updated_at })),
        );
      },
    );

    const txnResult = await pushChunks(
      dirtyTxns,
      (batch) => ({ customers: [], transactions: batch.map(toPushTransaction) }),
      (r) => r.transactions,
      async (acceptedIds, batch) => {
        await markTransactionsSynced(batch.filter((t) => acceptedIds.has(t.id)).map((t) => t.id));
      },
    );

    await persist();

    // ---- 2. pull server deltas, page by page ----
    let pulled = 0;
    let pages = 0;
    let drained = false;
    let cursor = await getCursor();
    for (;;) {
      const page = await syncPull(cursor, PULL_PAGE);

      for (const c of page.customers) {
        await applyServerCustomer({
          id: c.id, name: c.name, phone: c.phone, note: c.note, role: c.role,
          created_at: c.created_at, updated_at: c.updated_at, deleted_at: c.deleted_at,
        });
      }
      for (const t of page.transactions) {
        await applyServerTransaction({
          id: t.id, customer_id: t.customer_id, type: t.type as TxnType,
          amount: toMinor(Number(t.amount)), // major → minor for local storage
          currency: isCurrencyCode(t.currency) ? t.currency : BASE_CURRENCY,
          note: t.note, occurred_at: t.occurred_at, created_at: t.created_at,
        });
      }
      pulled += page.customers.length + page.transactions.length;

      // Save the cursor with the page it belongs to, before asking for the
      // next one. If the app is killed mid-drain, the next run resumes here
      // instead of re-downloading the whole history.
      cursor = page.synced_at;
      await setCursor(cursor);
      await persist();

      pages++;
      if (!page.has_more) { drained = true; break; }
      if (pages >= MAX_PULL_PAGES) break;
    }

    await setAccountActive(true); // a successful sync means the owner activated us

    const rejected = custResult.rejected + txnResult.rejected;
    // Stopping at the page cap means data is still waiting on the server, which
    // is not a clean sync — report it as partial so the warning stays up rather
    // than telling the owner everything is fine.
    if (!drained) console.warn('sync: pull hit the page cap without draining');
    const outcome: SyncOutcome = {
      status: rejected > 0 || !drained ? 'partial' : 'ok',
      pushed: custResult.accepted + txnResult.accepted,
      pulled,
      rejected,
    };
    await recordOutcome(outcome, rejected);
    return outcome;
  } catch (err) {
    await persist().catch(() => {}); // keep whatever did land
    // Anything still dirty is un-backed-up data the user should know about.
    const unsynced = await countDirty(dirtyCustomers.length + dirtyTxns.length);
    let outcome: SyncOutcome = { status: 'error' };
    if (err instanceof ApiError) {
      if (err.status === 402) {
        await setAccountActive(false); // server says not activated
        outcome = { status: 'subscription' };
      } else if (err.status === 0) {
        outcome = { status: 'offline' };
      }
    }
    if (outcome.status === 'error') console.warn('sync failed', err);
    await recordOutcome(outcome, unsynced);
    return outcome;
  }
}

// Re-count what is still dirty after a failure. Falls back to the pre-run
// figure if the database itself is the thing that broke.
async function countDirty(fallback: number): Promise<number> {
  try {
    const [customers, transactions] = await Promise.all([
      getDirtyCustomers(), getDirtyTransactions(),
    ]);
    return customers.length + transactions.length;
  } catch {
    return fallback;
  }
}
