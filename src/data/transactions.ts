import { getDB, persist } from './db';
import { uuidv4 } from './uuid';
import {
  BASE_CURRENCY, CURRENCIES, isCurrencyCode,
  type CurrencyBalance, type CurrencyCode,
} from './currencies';

// Transaction repository — append-only (CLAUDE.md): a transaction is never
// edited or deleted; a correction is a reversing entry. `amount` is INTEGER
// minor units and always positive; `type` carries the direction (debt/payment);
// `currency` carries WHAT was owed, and is the debt of record — a 100 SAR debt
// stays 100 SAR no matter what the rate does later (see currencies.ts).
//
// Because of that, a contact's balance is not one number: debts in different
// currencies never merge. Everything below returns a list, one entry per
// currency actually used.

export type TxnType = 'debt' | 'payment';

export interface Transaction {
  id: string;
  customer_id: string;
  type: TxnType;
  amount: number; // minor units, positive
  currency: CurrencyCode;
  note: string | null;
  occurred_at: string;
  created_at: string;
}

const COLS = 'id, customer_id, type, amount, currency, note, occurred_at, created_at';
const nowIso = () => new Date().toISOString();

// Canonical display order, so balances don't reshuffle between screens.
const CURRENCY_RANK = new Map<string, number>(CURRENCIES.map((c, i) => [c.code, i]));

function byCurrencyOrder(a: CurrencyBalance, b: CurrencyBalance): number {
  return (CURRENCY_RANK.get(a.currency) ?? 99) - (CURRENCY_RANK.get(b.currency) ?? 99);
}

// Rows come back from SQLite untyped; an unrecognised currency (a row synced
// from a newer app version) degrades to the base rather than breaking the list.
function normalizeCurrency(value: unknown): CurrencyCode {
  return isCurrencyCode(value) ? value : BASE_CURRENCY;
}

function toTransaction(row: Record<string, unknown>): Transaction {
  return {
    id: String(row.id),
    customer_id: String(row.customer_id),
    type: row.type === 'payment' ? 'payment' : 'debt',
    amount: Number(row.amount),
    currency: normalizeCurrency(row.currency),
    note: (row.note as string | null) ?? null,
    occurred_at: String(row.occurred_at),
    created_at: String(row.created_at),
  };
}

// Record a debt or payment for a contact. `amount` is minor units (> 0).
export async function addTransaction(input: {
  customerId: string;
  type: TxnType;
  amount: number;
  currency?: CurrencyCode;
  note?: string | null;
  occurredAt?: string;
}): Promise<Transaction> {
  if (input.type !== 'debt' && input.type !== 'payment') {
    throw new Error('نوع غير صحيح');
  }
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  }
  const currency = input.currency ?? BASE_CURRENCY;
  if (!isCurrencyCode(currency)) {
    throw new Error('عملة غير صحيحة');
  }

  const db = await getDB();
  const id = uuidv4();
  const now = nowIso();
  const occurredAt = input.occurredAt ?? now;
  await db.run(
    `INSERT INTO transactions
       (id, customer_id, type, amount, currency, note, occurred_at, created_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [id, input.customerId, input.type, input.amount, currency,
     input.note ?? null, occurredAt, now]
  );
  await persist();
  return {
    id, customer_id: input.customerId, type: input.type, amount: input.amount,
    currency, note: input.note ?? null, occurred_at: occurredAt, created_at: now,
  };
}

// A contact's transactions, newest first.
export async function listTransactions(customerId: string): Promise<Transaction[]> {
  const db = await getDB();
  const res = await db.query(
    `SELECT ${COLS} FROM transactions WHERE customer_id = ? ORDER BY created_at DESC`,
    [customerId]
  );
  return ((res.values ?? []) as Record<string, unknown>[]).map(toTransaction);
}

// Every transaction in the book, newest first — for the Excel export, which
// reports the whole ledger rather than one contact.
export async function listAllTransactions(): Promise<Transaction[]> {
  const db = await getDB();
  const res = await db.query(`SELECT ${COLS} FROM transactions ORDER BY created_at DESC`);
  return ((res.values ?? []) as Record<string, unknown>[]).map(toTransaction);
}

// ---- Sync helpers (used by data/sync.ts; they don't persist() — the sync run
// flushes once at the end) ----

// Transactions created locally but not yet pushed (synced = 0).
export async function getDirtyTransactions(): Promise<Transaction[]> {
  const db = await getDB();
  const res = await db.query(`SELECT ${COLS} FROM transactions WHERE synced = 0`);
  return ((res.values ?? []) as Record<string, unknown>[]).map(toTransaction);
}

export async function markTransactionsSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDB();
  for (const id of ids) {
    await db.run(`UPDATE transactions SET synced = 1 WHERE id = ?`, [id]);
  }
}

// Insert a server transaction if we don't have its UUID yet (append-only — never
// updated). `amount` is minor units (converted from the wire by the caller).
export async function applyServerTransaction(row: {
  id: string; customer_id: string; type: TxnType; amount: number;
  currency: CurrencyCode; note: string | null;
  occurred_at: string; created_at: string;
}): Promise<void> {
  const db = await getDB();
  const res = await db.query(`SELECT id FROM transactions WHERE id = ?`, [row.id]);
  if ((res.values ?? []).length > 0) return;
  await db.run(
    `INSERT INTO transactions
       (id, customer_id, type, amount, currency, note, occurred_at, created_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [row.id, row.customer_id, row.type, row.amount, normalizeCurrency(row.currency),
     row.note ?? null, row.occurred_at, row.created_at]
  );
}

// ---- Balances ----

// Running balance PER CURRENCY: sum(debt) − sum(payment) within each currency.
// Positive = the contact owes us; negative = we owe them. Currencies with a net
// zero are dropped — a settled SAR line is noise once it's paid off.
const BALANCE_SELECT = `
  SELECT currency,
         COALESCE(SUM(CASE WHEN type = 'debt'    THEN amount ELSE 0 END), 0) -
         COALESCE(SUM(CASE WHEN type = 'payment' THEN amount ELSE 0 END), 0) AS balance`;

export async function getBalances(customerId: string): Promise<CurrencyBalance[]> {
  const db = await getDB();
  const res = await db.query(
    `${BALANCE_SELECT} FROM transactions WHERE customer_id = ? GROUP BY currency`,
    [customerId]
  );
  return ((res.values ?? []) as { currency: unknown; balance: number }[])
    .map((r) => ({ currency: normalizeCurrency(r.currency), minor: Number(r.balance) }))
    .filter((b) => b.minor !== 0)
    .sort(byCurrencyOrder);
}

// Balances for every contact in ONE query, keyed by contact id.
//
// The list screen used to call getBalances() once per contact — a classic N+1:
// 200 contacts meant 200 round-trips through the Capacitor bridge on every
// screen entry, which is exactly the kind of thing that makes a phone app feel
// slow as the book grows. One grouped query costs the same as one of them.
export async function getBalancesByCustomer(): Promise<Map<string, CurrencyBalance[]>> {
  const db = await getDB();
  const res = await db.query(
    `${BALANCE_SELECT}, customer_id FROM transactions GROUP BY customer_id, currency`
  );
  const out = new Map<string, CurrencyBalance[]>();
  for (const row of (res.values ?? []) as
       { customer_id: string; currency: unknown; balance: number }[]) {
    const minor = Number(row.balance);
    if (minor === 0) continue;
    const list = out.get(row.customer_id) ?? [];
    list.push({ currency: normalizeCurrency(row.currency), minor });
    out.set(row.customer_id, list);
  }
  for (const list of out.values()) list.sort(byCurrencyOrder);
  return out;
}
