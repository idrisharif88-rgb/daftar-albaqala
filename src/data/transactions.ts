import { getDB, persist } from './db';
import { uuidv4 } from './uuid';

// Transaction repository — append-only (CLAUDE.md): a transaction is never
// edited or deleted; a correction is a reversing entry. `amount` is INTEGER
// minor units and always positive; `type` carries the direction (debt/payment).

export type TxnType = 'debt' | 'payment';

export interface Transaction {
  id: string;
  customer_id: string;
  type: TxnType;
  amount: number; // minor units, positive
  note: string | null;
  occurred_at: string;
  created_at: string;
}

const COLS = 'id, customer_id, type, amount, note, occurred_at, created_at';
const nowIso = () => new Date().toISOString();

// Record a debt or payment for a customer. `amount` is minor units (> 0).
export async function addTransaction(input: {
  customerId: string;
  type: TxnType;
  amount: number;
  note?: string | null;
  occurredAt?: string;
}): Promise<Transaction> {
  if (input.type !== 'debt' && input.type !== 'payment') {
    throw new Error('نوع غير صحيح');
  }
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  }

  const db = await getDB();
  const id = uuidv4();
  const now = nowIso();
  const occurredAt = input.occurredAt ?? now;
  await db.run(
    `INSERT INTO transactions (id, customer_id, type, amount, note, occurred_at, created_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [id, input.customerId, input.type, input.amount, input.note ?? null, occurredAt, now]
  );
  await persist();
  return {
    id, customer_id: input.customerId, type: input.type, amount: input.amount,
    note: input.note ?? null, occurred_at: occurredAt, created_at: now,
  };
}

// A customer's transactions, newest first.
export async function listTransactions(customerId: string): Promise<Transaction[]> {
  const db = await getDB();
  const res = await db.query(
    `SELECT ${COLS} FROM transactions WHERE customer_id = ? ORDER BY created_at DESC`,
    [customerId]
  );
  return (res.values ?? []) as Transaction[];
}

// ---- Sync helpers (used by data/sync.ts; they don't persist() — the sync run
// flushes once at the end) ----

// Transactions created locally but not yet pushed (synced = 0).
export async function getDirtyTransactions(): Promise<Transaction[]> {
  const db = await getDB();
  const res = await db.query(`SELECT ${COLS} FROM transactions WHERE synced = 0`);
  return (res.values ?? []) as Transaction[];
}

export async function markTransactionsSynced(ids: string[]): Promise<void> {
  const db = await getDB();
  for (const id of ids) {
    await db.run(`UPDATE transactions SET synced = 1 WHERE id = ?`, [id]);
  }
}

// Insert a server transaction if we don't have its UUID yet (append-only — never
// updated). `amount` is minor units (converted from the wire by the caller).
export async function applyServerTransaction(row: {
  id: string; customer_id: string; type: TxnType; amount: number;
  note: string | null; occurred_at: string; created_at: string;
}): Promise<void> {
  const db = await getDB();
  const res = await db.query(`SELECT id FROM transactions WHERE id = ?`, [row.id]);
  if ((res.values ?? []).length > 0) return;
  await db.run(
    `INSERT INTO transactions (id, customer_id, type, amount, note, occurred_at, created_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [row.id, row.customer_id, row.type, row.amount, row.note ?? null, row.occurred_at, row.created_at]
  );
}

// Running balance in minor units: sum(debt) − sum(payment). Positive = the
// customer owes the shop; negative = the shop owes the customer (overpaid).
export async function getBalance(customerId: string): Promise<number> {
  const db = await getDB();
  const res = await db.query(
    `SELECT
        COALESCE(SUM(CASE WHEN type = 'debt'    THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN type = 'payment' THEN amount ELSE 0 END), 0) AS balance
       FROM transactions WHERE customer_id = ?`,
    [customerId]
  );
  return Number((res.values ?? [])[0]?.balance ?? 0);
}
