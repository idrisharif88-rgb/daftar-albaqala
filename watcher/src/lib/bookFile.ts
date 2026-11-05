import type { Balance, Role, TxnType } from './api';

// A grocer's book sent as a file («إرسال دفتري للدعم» in the shop app) — the
// same JSON as its Google Drive backup (src/data/driveBackup.ts, BookBackup).
// It is read here and never sent anywhere: a free account's book does not live
// on the server, so this is how the owner sees it when the grocer needs help.
//
// The phone stores money in INTEGER minor units (1/100); everything here is
// converted to major units, the way the server's DECIMAL rows already are.

export interface FileContact {
  id: string;
  name: string;
  phone: string;
  note: string | null;
  role: Role;
  balances: Balance[];
  count: number;
}

export interface FileEntry {
  id: string;
  customer_id: string;
  type: TxnType;
  amount: number;
  currency: string;
  note: string | null;
  occurred_at: string | null;
}

export interface BookFile {
  storeName: string | null;
  savedAt: number | null;
  contacts: FileContact[];
  entries: FileEntry[];
}

type Row = Record<string, unknown>;
const rows = (tables: Row, name: string): Row[] =>
  Array.isArray(tables[name]) ? (tables[name] as unknown[]).filter((r): r is Row => !!r && typeof r === 'object') : [];
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

/** Parse the file's text. Throws an Arabic message on anything that is not a book. */
export function parseBookFile(text: string): BookFile {
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error('الملف ليس ملف دفتر صالح'); }
  const backup = json as Row;
  if (!backup || backup.app !== 'daftar-albaqala' || !backup.tables || typeof backup.tables !== 'object') {
    throw new Error('الملف ليس ملف دفتر صالح');
  }
  const tables = backup.tables as Row;

  const entries: FileEntry[] = rows(tables, 'transactions')
    .filter((t) => typeof t.id === 'string' && !t.deleted_at)
    .map((t) => ({
      id: String(t.id),
      customer_id: String(t.customer_id),
      type: t.type === 'payment' ? 'payment' : 'debt',
      amount: (Number(t.amount) || 0) / 100,
      currency: String(t.currency || 'YER'),
      note: str(t.note),
      occurred_at: str(t.occurred_at) ?? str(t.created_at),
    }));
  entries.sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));

  const byContact = new Map<string, Map<string, number>>();
  const counts = new Map<string, number>();
  for (const e of entries) {
    const m = byContact.get(e.customer_id) ?? new Map<string, number>();
    m.set(e.currency, (m.get(e.currency) ?? 0) + (e.type === 'debt' ? e.amount : -e.amount));
    byContact.set(e.customer_id, m);
    counts.set(e.customer_id, (counts.get(e.customer_id) ?? 0) + 1);
  }

  const contacts: FileContact[] = rows(tables, 'customers')
    .filter((c) => typeof c.id === 'string' && !c.deleted_at)
    .map((c) => ({
      id: String(c.id),
      name: String(c.name ?? ''),
      phone: String(c.phone ?? ''),
      note: str(c.note),
      role: String(c.role || 'customer') as Role,
      // A balance that nets to zero is settled — not shown, like the server's book.
      balances: [...(byContact.get(String(c.id)) ?? new Map()).entries()]
        .map(([currency, balance]) => ({ currency, balance: Math.round(balance * 100) / 100 }))
        .filter((b) => b.balance !== 0),
      count: counts.get(String(c.id)) ?? 0,
    }));
  contacts.sort((a, b) => a.name.localeCompare(b.name, 'ar'));

  const settings = Array.isArray(backup.settings) ? (backup.settings as Row[]) : [];
  const setting = (k: string) => str(settings.find((s) => s?.key === k)?.value);
  return {
    storeName: setting('store_name') ?? setting('owner_name') ?? setting('contractor_store_name'),
    savedAt: Number.isFinite(Number(backup.savedAt)) ? Number(backup.savedAt) : null,
    contacts,
    entries,
  };
}
