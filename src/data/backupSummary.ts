// What a Google Drive backup holds, read from the backup file itself. Nothing
// is stored about it: the summary is computed each time, so an old backup gets
// one too, and no second file can fall out of step with the first.
//
// Pure and defensive: a backup from an older app, a half-written one or plain
// garbage must give a summary (empty, if need be), never an exception.

export interface BackupSummary {
  contacts: number;
  entries: number;
  items: number;
  groups: number;
  /** True when the backup holds no book: no contact, entry, item or group.
   *  Settings alone (names, rates) do not count. */
  isEmpty: boolean;
  /** One line for the grocer, e.g. «12 جهة، 340 حركة، 47 صنف». */
  sentence: string;
}

type Row = Record<string, unknown>;

/** Rows of one table that are still alive (a soft-deleted row is a tombstone). */
const liveRows = (tables: unknown, name: string): number => {
  if (!tables || typeof tables !== 'object') return 0;
  const rows = (tables as Record<string, unknown>)[name];
  if (!Array.isArray(rows)) return 0;
  return rows.filter((r) => r && typeof r === 'object' && !(r as Row).deleted_at).length;
};

export function summarizeBackup(backup: unknown): BackupSummary {
  const tables = backup && typeof backup === 'object' ? (backup as Row).tables : undefined;
  const contacts = liveRows(tables, 'customers');
  const entries = liveRows(tables, 'transactions');
  const items = liveRows(tables, 'items');
  const groups = liveRows(tables, 'item_groups');
  const parts = [
    contacts && `${contacts} جهة`,
    entries && `${entries} حركة`,
    items && `${items} صنف`,
    groups && `${groups} مجموعة`,
  ].filter(Boolean);
  const isEmpty = parts.length === 0;
  return {
    contacts, entries, items, groups, isEmpty,
    sentence: isEmpty ? 'النسخة فارغة — لا توجد فيها جهات ولا حركات.' : parts.join('، '),
  };
}
