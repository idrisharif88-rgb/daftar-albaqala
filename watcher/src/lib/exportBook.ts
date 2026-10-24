import { Capacitor } from '@capacitor/core';
// Type-only: erased at build time, so the writer itself is still loaded on
// demand below (the import() in exportBookToFile).
import type { Row as XlsxRow, Sheet } from 'write-excel-file/browser';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { BookExport, ExportedContact, ExportedEntry } from './api';
import { ROLE_AR, dateTime } from './format';

// One account's whole book as a spreadsheet — what the owner hands a grocer who
// asks for a copy of his data.
//
// Written with `write-excel-file`, the same writer the shop app uses: it builds
// real .xlsx in the browser (styled cells, frozen headers, right-to-left
// sheets) with no Node polyfills, which matters inside a Capacitor WebView.
// Amounts and dates are real numeric and date cells, so the reader can sum,
// sort and filter them; a spreadsheet of text defeats the point of exporting.
//
// The Watcher knows no exchange rates — they live on the grocer's own phone and
// are deliberately not synced — so nothing here is converted. Each currency
// stands in its own column and the totals are per currency.
//
// The direction wording is the ledger's own, «دين» / «تسديد», not the
// role-dependent Arabic the shop app shows its owner. A book here is read
// across mixed roles at once, and the Watcher already speaks this way on screen
// (Contact.tsx) — one vocabulary in the app and in the file it produces.

const MONEY_FORMAT = '#,##0.##';
const DATE_FORMAT = 'yyyy-mm-dd hh:mm';
const HEADER_BG = '#1B5E20';
const HEADER_TEXT = '#FFFFFF';
const DEBT_COLOR = '#C0392B';
const PAYMENT_COLOR = '#1B5E20';

const CURRENCY_AR: Record<string, string> = {
  YER: 'ريال', SAR: 'ر.س', USD: '$', GOLD: 'جرام ذهب',
};
const currencyAr = (code: string) => CURRENCY_AR[code] ?? code;

type Cell = XlsxRow[number];

const headerRow = (labels: string[]): XlsxRow => labels.map((value) => ({
  value,
  fontWeight: 'bold' as const,
  backgroundColor: HEADER_BG,
  textColor: HEADER_TEXT,
  align: 'center' as const,
}));

const text = (value: string, extra: Partial<Exclude<Cell, null | undefined>> = {}): Cell =>
  ({ type: String, value, ...extra }) as Cell;

const amount = (value: number, textColor?: string): Cell =>
  ({ type: Number, value, format: MONEY_FORMAT, textColor });

const count = (value: number): Cell => ({ type: Number, value });

const when = (iso: string): Cell => ({ type: Date, value: new Date(iso), format: DATE_FORMAT });

/** The currencies this book actually trades in, in a stable order. */
function currenciesUsed(entries: ExportedEntry[]): string[] {
  const seen = new Set(entries.map((t) => t.currency));
  return ['YER', 'SAR', 'USD', 'GOLD'].filter((c) => seen.has(c))
    .concat([...seen].filter((c) => !['YER', 'SAR', 'USD', 'GOLD'].includes(c)).sort());
}

/** debt − payment per currency, per contact. Positive = the contact owes. */
function balances(entries: ExportedEntry[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const t of entries) {
    const row = out.get(t.customer_id) ?? new Map<string, number>();
    row.set(t.currency, (row.get(t.currency) ?? 0) + (t.type === 'debt' ? t.amount : -t.amount));
    out.set(t.customer_id, row);
  }
  return out;
}

export async function exportBookToFile(book: BookExport): Promise<void> {
  // Loaded on demand: the writer is the biggest thing the Watcher bundles, and
  // most visits never export anything.
  const { default: writeXlsxFile } = await import('write-excel-file/browser');

  const currencies = currenciesUsed(book.transactions);
  const byContact = balances(book.transactions);
  const counts = new Map<string, number>();
  for (const t of book.transactions) counts.set(t.customer_id, (counts.get(t.customer_id) ?? 0) + 1);

  // ---- Sheet 1: the contacts, a balance column per currency ----
  const contactsData: XlsxRow[] = [headerRow([
    'الاسم', 'الهاتف', 'الصفة',
    ...currencies.map((c) => `الرصيد (${currencyAr(c)})`),
    'عدد الحركات', 'ملاحظة',
  ])];
  for (const c of book.customers) {
    const bal = byContact.get(c.id);
    contactsData.push([
      text(c.name), text(c.phone), text(ROLE_AR[c.role] ?? c.role),
      // An untouched currency is left EMPTY rather than 0: a zero reads as
      // "settled", an empty cell as "never traded in this".
      ...currencies.map((code): Cell => {
        const v = bal?.get(code);
        if (v === undefined) return null;
        return amount(v, v > 0 ? DEBT_COLOR : v < 0 ? PAYMENT_COLOR : undefined);
      }),
      count(counts.get(c.id) ?? 0),
      text(c.note ?? ''),
    ]);
  }

  // ---- Sheet 2: every entry ----
  const nameById = new Map(book.customers.map((c: ExportedContact) => [c.id, c]));
  const entriesData: XlsxRow[] = [headerRow([
    'التاريخ', 'الجهة', 'الهاتف', 'الصفة', 'النوع', 'المبلغ', 'العملة', 'ملاحظة',
  ])];
  for (const t of book.transactions) {
    const c = nameById.get(t.customer_id);
    const color = t.type === 'debt' ? DEBT_COLOR : PAYMENT_COLOR;
    entriesData.push([
      when(t.occurred_at),
      text(c?.name ?? '—'), text(c?.phone ?? ''), text(c ? ROLE_AR[c.role] ?? c.role : ''),
      text(t.type === 'debt' ? 'دين' : 'تسديد', { textColor: color, fontWeight: 'bold' }),
      amount(t.amount, color),
      text(currencyAr(t.currency)),
      text(t.note ?? ''),
    ]);
  }

  // ---- Sheet 3: totals per currency ----
  const totalsData: XlsxRow[] = [headerRow([
    'العملة', 'إجمالي الديون (+)', 'إجمالي التسديد (−)', 'الرصيد',
  ])];
  for (const code of currencies) {
    const rows = book.transactions.filter((t) => t.currency === code);
    const debt = rows.filter((t) => t.type === 'debt').reduce((s, t) => s + t.amount, 0);
    const pay = rows.filter((t) => t.type === 'payment').reduce((s, t) => s + t.amount, 0);
    totalsData.push([
      text(currencyAr(code)), amount(debt, DEBT_COLOR), amount(pay, PAYMENT_COLOR),
      amount(debt - pay),
    ]);
  }
  totalsData.push([]);
  totalsData.push([text('الحساب'), text(book.account.store_name || book.account.phone)]);
  totalsData.push([text('تاريخ النسخة'), text(dateTime(book.exported_at))]);

  const sheets = [
    {
      sheet: 'الجهات', data: contactsData, rightToLeft: true, stickyRowsCount: 1,
      columns: [{ width: 26 }, { width: 16 }, { width: 12 },
        ...currencies.map(() => ({ width: 15 })), { width: 12 }, { width: 30 }],
    },
    {
      sheet: 'الحركات', data: entriesData, rightToLeft: true, stickyRowsCount: 1,
      columns: [{ width: 20 }, { width: 26 }, { width: 16 }, { width: 12 },
        { width: 12 }, { width: 15 }, { width: 12 }, { width: 34 }],
    },
    {
      sheet: 'الإجماليات', data: totalsData, rightToLeft: true, stickyRowsCount: 1,
      columns: [{ width: 16 }, { width: 20 }, { width: 20 }, { width: 18 }],
    },
  ] satisfies Sheet<Blob>[];

  const blob = await writeXlsxFile(sheets, { fontFamily: 'Arial', fontSize: 11 }).toBlob();

  // `/ \ : * ? " < > |` are illegal in a filename; Arabic itself is fine.
  const safe = (s: string) => s.replace(/[/\\:*?"<>|]/g, '').trim().replace(/\s+/g, '_');
  const who = safe(book.account.store_name || book.account.phone).slice(0, 40) || 'حساب';
  const day = new Date().toISOString().slice(0, 10);
  await deliver(blob, `دفتر-${who}-${day}.xlsx`, `دفتر ${who}`);
}

// Download in the browser; on the phone write to the cache dir and hand the
// file to the system share sheet (WhatsApp, Drive, email — the owner picks).
async function deliver(blob: Blob, filename: string, title: string): Promise<void> {
  if (Capacitor.getPlatform() === 'web') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const written = await Filesystem.writeFile({
    path: filename, data: await blobToBase64(blob), directory: Directory.Cache,
  });
  try {
    await Share.share({ title, url: written.uri });
  } catch {
    // The file exists; what failed is finding something to open it with — or
    // the owner simply backed out of the sheet, which is not an error worth
    // shouting about.
    throw new Error('تعذّر إرسال الملف. تأكد من وجود تطبيق يفتح ملفات Excel.');
  }
}

// FileReader gives a data: URL; the plugin wants the payload without the prefix.
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('failed to read workbook'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(blob);
  });
}
