import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { classifyShareError } from './shareTarget';
// The package has no root export — the browser build is the one that produces a
// Blob in a WebView (the /node build wants a filesystem stream).
import writeXlsxFile, { type Row as XlsxRow, type Sheet } from 'write-excel-file/browser';
import { listCustomers, type Customer } from '../data/customers';
import { listAllTransactions, getBalancesByCustomer, type Transaction } from '../data/transactions';
import { fromMinor } from '../data/money';
import {
  BASE_CURRENCY, CURRENCIES, currencyDef, totalInBase,
  type CurrencyBalance, type CurrencyCode, type Rates,
} from '../data/currencies';
import {
  directionLabel, isGrowthEntry, orderedTypes, ownerBalanceLabel, roleDef,
} from '../data/roles';

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
  // ASCII filename for the whole-book file; the store name rides in the share
  // caption instead.
  await deliverXlsx(
    blob,
    `daftar-${stamp}.xlsx`,
    `دفتر ${o.storeName || 'الحسابات'}`,
    `كشف كامل — ${stamp}`,
  );
}

// ---- Per-contact statement (the Excel counterpart of the PDF one) ----

/** Same options object the PDF statement takes, so the detail screen can hand
 *  the identical thing to either exporter. */
export interface CustomerStatementOptions {
  customer: Customer;
  transactions: Transaction[]; // already filtered to the chosen period
  storeName: string;
  ownerName: string;
  rates: Rates;
  periodLabel: string;
}

/**
 * Build and share an .xlsx for a SINGLE contact: one sheet of its entries and
 * a role-aware per-currency totals summary. Same reasoning as the whole-book
 * export — real numeric cells, so the reader can sum and sort.
 */
export async function exportCustomerStatementXlsx(o: CustomerStatementOptions): Promise<void> {
  const { customer, transactions, rates } = o;
  const role = customer.role;

  // ---- Sheet 1: this contact's entries (caller already ordered them) ----
  const txnData: XlsxRow[] = [
    headerRow(['التاريخ', 'النوع', 'المبلغ', 'العملة', 'ملاحظة']),
  ];
  for (const t of transactions) {
    const color = isGrowthEntry(role, t.type) ? DEBT_COLOR : PAYMENT_COLOR;
    txnData.push([
      { type: Date, value: new Date(t.occurred_at), format: DATE_FORMAT },
      textCell(directionLabel(role, t.type), { textColor: color, fontWeight: 'bold' }),
      moneyCell(t.amount, color),
      textCell(currencyDef(t.currency).shortAr),
      textCell(t.note ?? ''),
    ]);
  }
  const txnSheet: Sheet<Blob> = {
    sheet: 'الحركات',
    data: txnData,
    rightToLeft: true,
    stickyRowsCount: 1,
    columns: [{ width: 20 }, { width: 16 }, { width: 16 }, { width: 10 }, { width: 40 }],
  };

  // ---- Sheet 2: identity + per-currency totals ----
  // Role-aware, like the PDF: against a صاحب متجر the 'payment' rows ARE the
  // debts, so the two total columns are named from the role, not the raw type.
  const [growsType, settlesType] = orderedTypes(role);
  const perCurrency = new Map<CurrencyCode, { grows: number; settles: number }>();
  for (const t of transactions) {
    const e = perCurrency.get(t.currency) ?? { grows: 0, settles: 0 };
    if (t.type === growsType) e.grows += t.amount;
    else e.settles += t.amount;
    perCurrency.set(t.currency, e);
  }

  const issuer = o.ownerName.trim() || o.storeName.trim();
  const summaryData: XlsxRow[] = [
    [textCell(`كشف حساب: ${customer.name}`, { fontWeight: 'bold' })],
    [textCell(`الهاتف: ${customer.phone}`), textCell(`الصفة: ${roleDef(role).labelAr}`)],
    [
      textCell(`الفترة: ${o.periodLabel}`),
      issuer ? textCell(`صاحب الكشف: ${issuer}`) : null,
    ],
    [],
    headerRow([
      'العملة',
      `إجمالي ${directionLabel(role, growsType)}`,
      `إجمالي ${directionLabel(role, settlesType)}`,
      'الرصيد', 'الاتجاه',
    ]),
  ];

  const balances: CurrencyBalance[] = [];
  for (const c of CURRENCIES) {
    const e = perCurrency.get(c.code);
    if (!e) continue;
    // The signed balance still comes from the stored types, unchanged.
    const signed = growsType === 'debt' ? e.grows - e.settles : e.settles - e.grows;
    balances.push({ currency: c.code, minor: signed });
    summaryData.push([
      textCell(c.longAr, { fontWeight: 'bold' }),
      moneyCell(e.grows, DEBT_COLOR),
      moneyCell(e.settles, PAYMENT_COLOR),
      moneyCell(signed),
      textCell(ownerBalanceLabel(signed)),
    ]);
  }

  const { minor: totalMinor, complete } = totalInBase(balances, rates);
  summaryData.push([]);
  if (balances.length > 1 && complete) {
    summaryData.push([
      textCell('الإجمالي التقريبي بالريال', { fontWeight: 'bold' }),
      null, null,
      moneyCell(totalMinor),
      textCell(ownerBalanceLabel(totalMinor)),
    ]);
    summaryData.push([
      textCell('محسوب بأسعار اليوم؛ كل عملة محفوظة بأصلها.', { textColor: '#777777' }),
    ]);
  } else if (balances.length > 1) {
    summaryData.push([
      textCell('بعض الأسعار غير محددة في الإعدادات، لذا الإجمالي بالريال غير مكتمل.', {
        textColor: '#777777',
      }),
    ]);
  }

  const summarySheet: Sheet<Blob> = {
    sheet: 'الملخص',
    data: summaryData,
    rightToLeft: true,
    columns: [{ width: 22 }, { width: 18 }, { width: 18 }, { width: 16 }, { width: 12 }],
  };

  const blob = await writeXlsxFile([txnSheet, summarySheet], {
    fontFamily: 'Arial', fontSize: 11,
  }).toBlob();

  // Arabic filename, as the PDF statement does — it is the only label the file
  // carries once it is in a WhatsApp thread. `/ \ : * ? " < > |` are illegal in
  // a filename; Arabic itself is fine.
  const safe = (s: string) => s.replace(/[/\\:*?"<>|]/g, '').trim().replace(/\s+/g, '_');
  const day = new Date().toISOString().slice(0, 10);
  const filename = `كشف-${safe(customer.name).slice(0, 40) || 'حساب'}-${day}.xlsx`;
  await deliverXlsx(
    blob,
    filename,
    `كشف حساب ${customer.name}`,
    `${o.storeName || 'دفتر البقالة'} — ${o.periodLabel}`,
  );
}

// Download on web; otherwise write to the cache dir and hand the file to the
// system share sheet (WhatsApp, Drive, email — the owner picks).
async function deliverXlsx(
  blob: Blob, filename: string, title: string, text: string,
): Promise<void> {
  if (Capacitor.getPlatform() === 'web') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const base64 = await blobToBase64(blob);
  const written = await Filesystem.writeFile({
    path: filename, data: base64, directory: Directory.Cache,
  });
  try {
    await Share.share({ title, text, url: written.uri });
  } catch (err) {
    // The workbook exists; what failed is finding something to open it with —
    // or the owner backed out of the sheet (shareTarget.ts).
    throw classifyShareError(err);
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
