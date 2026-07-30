import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
// The package has no root export — the browser build is the one that produces a
// Blob in a WebView (the /node build wants a filesystem stream).
import writeXlsxFile, { type Row as XlsxRow, type Sheet } from 'write-excel-file/browser';
import { listCustomers, type Customer } from '../data/customers';
import { listAllTransactions, getBalancesByCustomer } from '../data/transactions';
import { fromMinor } from '../data/money';
import {
  BASE_CURRENCY, CURRENCIES, currencyDef, totalInBase,
  type CurrencyBalance, type CurrencyCode, type Rates,
} from '../data/currencies';
import { directionLabel, isGrowthEntry, ownerBalanceLabel, roleDef } from '../data/roles';

// Excel export of the whole book: a summary sheet, every transaction, and
// per-currency totals.
//
// Written with `write-excel-file`, which builds real .xlsx (styled cells,
// column widths, frozen headers, right-to-left sheets, numeric cells) in the
// browser with no server round-trip and no Node polyfills. That last part
// matters — the obvious alternative, exceljs, expects Node's Buffer/stream and
// needs shimming to run inside a Capacitor WebView.
//
// The numbers are written as NUMBERS, not strings. A spreadsheet whose amounts
// are text can't be summed, filtered or charted, which defeats the point of
// exporting to Excel at all — so amounts are real numeric cells carrying a
// display format, and the arithmetic stays the reader's to do.
//
// PERFORMANCE: everything is read in three queries (contacts, all transactions,
// grouped balances) and formatted in memory. There is no per-contact query and
// no rendering step, so a book with tens of thousands of rows exports in about
// the time it takes to write the file.

// Amounts: thousands separator, up to 2 decimals, no trailing ".00" on round
// numbers — the same shape the app shows on screen.
const MONEY_FORMAT = '#,##0.##';
const DATE_FORMAT = 'yyyy-mm-dd hh:mm';

const HEADER_BG = '#1B5E20';
const HEADER_TEXT = '#FFFFFF';
const DEBT_COLOR = '#C0392B';
const PAYMENT_COLOR = '#1B5E20';

type Cell = XlsxRow[number];

function headerRow(labels: string[]): XlsxRow {
  return labels.map((value) => ({
    value,
    fontWeight: 'bold' as const,
    backgroundColor: HEADER_BG,
    textColor: HEADER_TEXT,
    align: 'center' as const,
  }));
}

function moneyCell(minor: number, color?: string): Cell {
  return {
    type: Number,
    value: fromMinor(minor),
    format: MONEY_FORMAT,
    textColor: color,
  };
}

function textCell(value: string, extra: Partial<Exclude<Cell, null | undefined>> = {}): Cell {
  return { type: String, value, ...extra } as Cell;
}

export interface WorkbookOptions {
  storeName: string;
  rates: Rates;
}

// ---- Sheet 1: one row per contact, with a column per currency ----
//
// A contact can owe in several currencies at once, so a single "balance"
// column would have to either drop information or mash unlike units together.
// Instead each currency gets its own column and the reader can sum whichever
// they care about.
function summarySheet(
  customers: Customer[],
  balances: Map<string, CurrencyBalance[]>,
  rates: Rates,
): Sheet<Blob> {
  const currencyColumns = CURRENCIES;
  const data: XlsxRow[] = [
    headerRow([
      'الاسم', 'الهاتف', 'الصفة',
      ...currencyColumns.map((c) => `الرصيد (${c.shortAr})`),
      `الإجمالي التقريبي (${currencyDef(BASE_CURRENCY).shortAr})`,
      'الاتجاه', 'ملاحظة',
    ]),
  ];

  for (const customer of customers) {
    const list = balances.get(customer.id) ?? [];
    const byCode = new Map(list.map((b) => [b.currency, b.minor]));
    const { minor: totalMinor, complete } = totalInBase(list, rates);
    data.push([
      textCell(customer.name),
      textCell(customer.phone),
      textCell(roleDef(customer.role).labelAr),
      ...currencyColumns.map((c): Cell => {
        const minor = byCode.get(c.code);
        // Leave untouched currencies empty rather than writing 0 — a zero reads
        // as "settled", an empty cell as "never traded in this".
        if (minor === undefined) return null;
        return moneyCell(minor, minor > 0 ? DEBT_COLOR : minor < 0 ? PAYMENT_COLOR : undefined);
      }),
      // Marked when a rate is missing, so a short total is never mistaken for
      // the real figure.
      complete ? moneyCell(totalMinor) : textCell('—'),
      textCell(list.length ? ownerBalanceLabel(totalMinor) : 'مسدد'),
      textCell(customer.note ?? ''),
    ]);
  }

  return {
    sheet: 'ملخص الجهات',
    data,
    rightToLeft: true,
    stickyRowsCount: 1,
    columns: [
      { width: 26 }, { width: 16 }, { width: 10 },
      ...currencyColumns.map(() => ({ width: 15 })),
      { width: 20 }, { width: 10 }, { width: 30 },
    ],
  };
}

// ---- Sheet 2: every transaction ----
function transactionsSheet(
  customers: Customer[],
  transactions: Awaited<ReturnType<typeof listAllTransactions>>,
): Sheet<Blob> {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const data: XlsxRow[] = [
    headerRow(['التاريخ', 'الجهة', 'الهاتف', 'الصفة', 'النوع', 'المبلغ', 'العملة', 'ملاحظة']),
  ];

  for (const t of transactions) {
    const customer = byId.get(t.customer_id);
    const role = customer?.role ?? 'customer';
    // Red for an entry that grows what is owed, green for one that settles it.
    // Which stored type that is depends on the role — against a صاحب متجر the
    // 'payment' rows are the debts.
    const color = isGrowthEntry(role, t.type) ? DEBT_COLOR : PAYMENT_COLOR;
    data.push([
      // A real date cell, so Excel can sort and filter chronologically.
      { type: Date, value: new Date(t.occurred_at), format: DATE_FORMAT },
      textCell(customer?.name ?? '—'),
      textCell(customer?.phone ?? ''),
      textCell(roleDef(role).labelAr),
      textCell(directionLabel(role, t.type), { textColor: color, fontWeight: 'bold' }),
      moneyCell(t.amount, color),
      textCell(currencyDef(t.currency).shortAr),
      textCell(t.note ?? ''),
    ]);
  }

  return {
    sheet: 'الحركات',
    data,
    rightToLeft: true,
    stickyRowsCount: 1,
    columns: [
      { width: 20 }, { width: 26 }, { width: 16 }, { width: 10 },
      { width: 14 }, { width: 15 }, { width: 10 }, { width: 34 },
    ],
  };
}

// ---- Sheet 3: totals per currency, plus the rates they were valued at ----
function totalsSheet(
  transactions: Awaited<ReturnType<typeof listAllTransactions>>,
  rates: Rates,
): Sheet<Blob> {
  const totals = new Map<CurrencyCode, { debt: number; pay: number }>();
  for (const t of transactions) {
    const entry = totals.get(t.currency) ?? { debt: 0, pay: 0 };
    if (t.type === 'debt') entry.debt += t.amount;
    else entry.pay += t.amount;
    totals.set(t.currency, entry);
  }

  // This sheet spans the whole book, so it can't name the two directions the way
  // a single contact's statement does — «دين» against a زبون and against a
  // صاحب متجر are opposite signs. It reports the sign instead, and the per-role
  // wording lives in the الحركات sheet.
  const data: XlsxRow[] = [
    headerRow([
      'العملة', 'إجمالي الزيادة (+)', 'إجمالي النقص (−)', 'الرصيد',
      'السعر مقابل الريال', 'ما يعادله بالريال',
    ]),
  ];

  const balances: CurrencyBalance[] = [];
  for (const c of CURRENCIES) {
    const entry = totals.get(c.code);
    if (!entry) continue;
    const balance = entry.debt - entry.pay;
    balances.push({ currency: c.code, minor: balance });
    const rate = c.isBase ? 1 : rates[c.code];
    data.push([
      textCell(c.longAr, { fontWeight: 'bold' }),
      moneyCell(entry.debt, DEBT_COLOR),
      moneyCell(entry.pay, PAYMENT_COLOR),
      moneyCell(balance),
      rate > 0 ? { type: Number, value: rate, format: MONEY_FORMAT } : textCell('غير محدد'),
      rate > 0 ? moneyCell(Math.round(balance * rate)) : textCell('—'),
    ]);
  }

  const { minor: grandMinor, complete } = totalInBase(balances, rates);
  data.push([]);
  data.push([
    textCell('الإجمالي التقريبي', { fontWeight: 'bold' }),
    null, null, null, null,
    complete ? moneyCell(grandMinor, DEBT_COLOR) : textCell('ناقص — بعض الأسعار غير محددة'),
  ]);
  data.push([
    textCell(
      complete
        ? 'المبالغ بالعملات الأخرى والذهب محفوظة بعملتها الأصلية؛ ما يقابلها بالريال محسوب بأسعار اليوم.'
        : 'بعض الأسعار غير محددة في الإعدادات، لذا الإجمالي بالريال غير مكتمل.',
      { textColor: '#777777' },
    ),
  ]);
  data.push([
    textCell(
      '(+) حركات تزيد ما لك على الجهة، و(−) حركات تنقصه. تسمية كل حركة حسب صفة ' +
      'الجهة (زبون / صاحب متجر / شريك) تجدها في ورقة «الحركات».',
      { textColor: '#777777' },
    ),
  ]);

  return {
    sheet: 'الإجماليات',
    data,
    rightToLeft: true,
    stickyRowsCount: 1,
    columns: [
      { width: 20 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 20 }, { width: 22 },
    ],
  };
}

/** Build and share an .xlsx of the entire book. */
export async function exportWorkbook(o: WorkbookOptions): Promise<void> {
  const [customers, transactions, balances] = await Promise.all([
    listCustomers(), listAllTransactions(), getBalancesByCustomer(),
  ]);

  const blob = await writeXlsxFile(
    [
      summarySheet(customers, balances, o.rates),
      transactionsSheet(customers, transactions),
      totalsSheet(transactions, o.rates),
    ],
    { fontFamily: 'Arial', fontSize: 11 },
  ).toBlob();

  const stamp = new Date().toISOString().slice(0, 10);
  // ASCII filename: the share plugin's sanitiser mangles Arabic ones, and the
  // store name goes in the share caption instead where it displays correctly.
  const filename = `daftar-${stamp}.xlsx`;

  if (Capacitor.getPlatform() === 'web') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  // Native: write to the cache directory, then hand the file to the system
  // share sheet (WhatsApp, Drive, email — the owner picks).
  const base64 = await blobToBase64(blob);
  const written = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
  });
  await Share.share({
    title: `دفتر ${o.storeName || 'الحسابات'}`,
    text: `كشف كامل — ${stamp}`,
    url: written.uri,
  });
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
