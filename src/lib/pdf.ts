import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { jsPDF } from 'jspdf';
import { formatMinor } from '../data/money';
import type { Customer } from '../data/customers';
import type { Transaction } from '../data/transactions';
import {
  BASE_CURRENCY, CURRENCIES, currencyDef, formatAmount, totalInBase,
  type CurrencyBalance, type Rates,
} from '../data/currencies';
import {
  directionLabel, isGrowthEntry, orderedTypes, ownerBalanceLabel, roleDef,
} from '../data/roles';

// Per-customer PDF statement.
//
// Arabic in a PDF is the hard part: jsPDF cannot SHAPE Arabic (letters join,
// and the run is right-to-left), so a text PDF would come out as disconnected
// letters in the wrong order. The way round it is to let the browser do the
// shaping and put the result in as an image.
//
// PERFORMANCE — why this file draws instead of rendering HTML:
// it used to build each page as an HTML node and snapshot it with html2canvas.
// That works, but html2canvas clones the DOM, re-parses every stylesheet in the
// document and lays the whole thing out again for EVERY page — seconds per page
// on a tablet, which is what made the export feel broken next to the instant
// Excel one. Here each page is painted straight onto a canvas with fillText /
// fillRect. The browser still shapes the Arabic (that is the whole reason the
// output is a bitmap), but there is no DOM, no CSS cascade and no layout pass,
// so a page costs a few milliseconds instead of a few seconds.
//
// On native (Android) the PDF is sent to WhatsApp with the file attached — the
// grocer then picks which chat (WhatsApp's public API cannot both pre-select a
// chat AND attach a file). If WhatsApp isn't installed we fall back to the
// system share sheet. On web it downloads.

// cordova-plugin-x-socialsharing exposes itself on window.plugins.socialsharing.
declare global {
  interface Window {
    plugins?: {
      socialsharing?: {
        // fileOrFileArray accepts a local path, an http(s) URL, or a
        // "df:<name>;data:<mime>;base64,<data>" string (used here for the PDF).
        shareViaWhatsApp: (
          message: string | null,
          fileOrFileArray: string | string[] | null,
          url: string | null,
          onSuccess?: () => void,
          onError?: (err: string) => void,
        ) => void;
      };
    };
  }
}

export interface StatementOptions {
  customer: Customer;
  transactions: Transaction[]; // already filtered to the chosen period
  storeName: string;
  /** Today's YER rates, for the reference conversions in the totals block. */
  rates: Rates;
  periodLabel: string;
}

// ---- Page geometry (pixels; A4 at ~150dpi, so text stays crisp on paper) ----
const PAGE_W = 1240;
const PAGE_H = Math.round((PAGE_W * 297) / 210); // 1754
const MARGIN = 60;
const CONTENT_W = PAGE_W - MARGIN * 2;

const ROW_H = 50;
const HEAD_H = 56;
const TABLE_TOP = 360;
const FOOTER_H = 70;
const ROWS_PER_PAGE = Math.floor((PAGE_H - TABLE_TOP - HEAD_H - FOOTER_H) / ROW_H);
// Rows the totals block displaces on the last page; past this it gets its own.
const ROWS_LEAVING_ROOM_FOR_TOTALS = ROWS_PER_PAGE - 8;

const FONT = 'Tajawal, sans-serif';
const GREEN = '#1b5e20';
const RED = '#c0392b';
const INK = '#222222';
const MUTED = '#777777';
const LINE = '#dddddd';
const ZEBRA = '#f7f9f7';

// Columns, laid out RIGHT to LEFT — the first entry is the rightmost column,
// which is where an Arabic reader starts.
const COLUMNS = [
  { title: 'التاريخ', width: 260, rtl: false },
  { title: 'النوع', width: 240, rtl: true },
  { title: 'المبلغ', width: 300, rtl: true },
  { title: 'ملاحظة', width: CONTENT_W - 800, rtl: true },
];

type Ctx = CanvasRenderingContext2D;

/**
 * A timestamp as «2026-07-30 18:47».
 *
 * NOT toLocaleString('ar'): that returns Arabic-Indic digits wrapped in
 * direction marks, and canvas resolves those against the surrounding run — in a
 * table cell the day, month and time came out in a scrambled order. A fixed
 * Latin-digit form has no bidi to resolve, lines up in a column, and matches
 * what the Excel export writes.
 */
function stamp(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// The @font-face is declared in CSS, but a font is only actually loaded once
// something needs it — and canvas silently falls back to a default (which does
// not carry Arabic well) if it isn't ready. So ask for it explicitly, once.
let fontsReady: Promise<void> | null = null;
function ensureFonts(): Promise<void> {
  if (!fontsReady) {
    fontsReady = Promise.all([
      document.fonts.load(`400 28px ${FONT}`),
      document.fonts.load(`700 28px ${FONT}`),
    ]).then(() => undefined).catch(() => undefined);
  }
  return fontsReady;
}

interface TextOpts {
  size?: number;
  bold?: boolean;
  color?: string;
  rtl?: boolean;
  align?: CanvasTextAlign;
  maxWidth?: number;
}

function text(ctx: Ctx, value: string, x: number, y: number, o: TextOpts = {}): void {
  ctx.font = `${o.bold ? 700 : 400} ${o.size ?? 26}px ${FONT}`;
  ctx.fillStyle = o.color ?? INK;
  ctx.textAlign = o.align ?? 'center';
  ctx.textBaseline = 'middle';
  // Direction decides bidi resolution: Arabic cells read right-to-left, while a
  // date or an amount must stay left-to-right or the digits come out reversed.
  ctx.direction = o.rtl === false ? 'ltr' : 'rtl';
  ctx.fillText(o.maxWidth ? clip(ctx, value, o.maxWidth) : value, x, y);
}

// Trim to fit the column rather than letting a long note run into the next one.
function clip(ctx: Ctx, value: string, maxWidth: number): string {
  if (ctx.measureText(value).width <= maxWidth) return value;
  let cut = value;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, color = LINE): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** Centre x of each column, and its width — computed once, right to left. */
const COLUMN_LAYOUT = (() => {
  let right = PAGE_W - MARGIN;
  return COLUMNS.map((c) => {
    const centre = right - c.width / 2;
    const left = right - c.width;
    right = left;
    return { ...c, centre, left };
  });
})();

function drawHeader(ctx: Ctx, o: StatementOptions, issuedAt: string): void {
  text(ctx, o.storeName || 'دفتر البقالة', PAGE_W / 2, 96, { size: 46, bold: true, color: GREEN });
  text(ctx, `كشف حساب ${roleDef(o.customer.role).labelAr}`, PAGE_W / 2, 156, {
    size: 30, color: MUTED,
  });

  // Two info rows: name / phone, then period / issue date.
  const right = PAGE_W - MARGIN;
  const mid = PAGE_W / 2;
  text(ctx, `الاسم: ${o.customer.name}`, right, 226, { size: 26, bold: true, align: 'right' });
  text(ctx, `الهاتف: ${o.customer.phone}`, mid, 226, { size: 26, align: 'right' });
  text(ctx, `الفترة: ${o.periodLabel}`, right, 276, { size: 26, align: 'right' });
  text(ctx, `تاريخ الإصدار: ${issuedAt}`, mid, 276, { size: 26, align: 'right' });
}

function drawTableHead(ctx: Ctx, y: number): void {
  ctx.fillStyle = GREEN;
  ctx.fillRect(MARGIN, y, CONTENT_W, HEAD_H);
  for (const col of COLUMN_LAYOUT) {
    text(ctx, col.title, col.centre, y + HEAD_H / 2, { size: 26, bold: true, color: '#ffffff' });
  }
}

function drawRows(ctx: Ctx, txns: Transaction[], role: string, top: number): number {
  let y = top;
  if (txns.length === 0) {
    text(ctx, 'لا توجد حركات في هذه الفترة', PAGE_W / 2, y + ROW_H / 2, { size: 26, color: MUTED });
    return y + ROW_H;
  }
  txns.forEach((t, i) => {
    if (i % 2 === 1) {
      ctx.fillStyle = ZEBRA;
      ctx.fillRect(MARGIN, y, CONTENT_W, ROW_H);
    }
    const mid = y + ROW_H / 2;
    const grows = isGrowthEntry(role, t.type);
    const cells = [
      { value: stamp(t.occurred_at), opts: { size: 22, rtl: false } as TextOpts },
      { value: directionLabel(role, t.type), opts: { size: 24, bold: true, color: grows ? RED : GREEN } },
      { value: formatAmount(t.amount, t.currency), opts: { size: 24 } },
      { value: (t.note ?? '').trim(), opts: { size: 22, color: MUTED } },
    ];
    COLUMN_LAYOUT.forEach((col, idx) => {
      const cell = cells[idx];
      if (cell.value) {
        text(ctx, cell.value, col.centre, mid, { ...cell.opts, maxWidth: col.width - 16 });
      }
    });
    line(ctx, MARGIN, y + ROW_H, PAGE_W - MARGIN, y + ROW_H);
    y += ROW_H;
  });
  return y;
}

// Totals are PER CURRENCY — riyals, dollars and grams of gold are separate
// debts and adding them together would be meaningless. The riyal estimate at
// the bottom is a convenience, labelled as today's rates.
//
// The two total columns are named for the contact's ROLE, not for the stored
// type: against a صاحب متجر the 'payment' rows ARE the debts, so a column
// headed «إجمالي الديون» over the 'debt' rows would report the exact opposite.
function drawTotals(ctx: Ctx, o: StatementOptions, top: number): void {
  const role = o.customer.role;
  const [growsType, settlesType] = orderedTypes(role);

  const perCurrency = new Map<string, { grows: number; settles: number }>();
  for (const t of o.transactions) {
    const entry = perCurrency.get(t.currency) ?? { grows: 0, settles: 0 };
    if (t.type === growsType) entry.grows += t.amount;
    else entry.settles += t.amount;
    perCurrency.set(t.currency, entry);
  }

  const balances: CurrencyBalance[] = [];
  const rows: { cells: string[]; colors: (string | undefined)[] }[] = [];
  for (const c of CURRENCIES) {
    const entry = perCurrency.get(c.code);
    if (!entry) continue;
    // The signed balance still comes from the stored types, unchanged.
    const signed = growsType === 'debt'
      ? entry.grows - entry.settles
      : entry.settles - entry.grows;
    balances.push({ currency: c.code, minor: signed });
    rows.push({
      cells: [
        c.longAr,
        formatAmount(entry.grows, c.code),
        formatAmount(entry.settles, c.code),
        `${formatAmount(Math.abs(signed), c.code)} ${ownerBalanceLabel(signed)}`,
      ],
      colors: [undefined, RED, GREEN, undefined],
    });
  }
  if (rows.length === 0) return;

  const heads = [
    'العملة',
    `إجمالي ${directionLabel(role, growsType)}`,
    `إجمالي ${directionLabel(role, settlesType)}`,
    'الرصيد',
  ];
  const colW = CONTENT_W / 4;
  const centreOf = (i: number) => PAGE_W - MARGIN - colW * i - colW / 2;

  let y = top + 40;
  ctx.fillStyle = '#eef2ee';
  ctx.fillRect(MARGIN, y, CONTENT_W, HEAD_H);
  heads.forEach((h, i) => text(ctx, h, centreOf(i), y + HEAD_H / 2, { size: 24, bold: true }));
  y += HEAD_H;

  for (const row of rows) {
    row.cells.forEach((value, i) => {
      text(ctx, value, centreOf(i), y + ROW_H / 2, {
        size: 24, color: row.colors[i], bold: i === 3, maxWidth: colW - 16,
      });
    });
    line(ctx, MARGIN, y + ROW_H, PAGE_W - MARGIN, y + ROW_H);
    y += ROW_H;
  }

  const { minor: totalMinor, complete } = totalInBase(balances, o.rates);
  if (balances.length > 1 && complete) {
    const baseShort = currencyDef(BASE_CURRENCY).shortAr;
    text(
      ctx,
      `الإجمالي التقريبي: ${formatMinor(Math.abs(totalMinor))} ${baseShort} ` +
      `${ownerBalanceLabel(totalMinor)} (بأسعار اليوم)`,
      PAGE_W / 2, y + 44, { size: 24, bold: true },
    );
  }
}

function drawPage(
  ctx: Ctx,
  o: StatementOptions,
  txns: Transaction[],
  pageNo: number,
  totalPages: number,
  withTotals: boolean,
  issuedAt: string,
): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  drawHeader(ctx, o, issuedAt);
  drawTableHead(ctx, TABLE_TOP);
  const afterRows = drawRows(ctx, txns, o.customer.role, TABLE_TOP + HEAD_H);
  if (withTotals) drawTotals(ctx, o, afterRows);

  text(ctx, `صفحة ${pageNo} من ${totalPages}`, PAGE_W / 2, PAGE_H - 40, {
    size: 20, color: '#999999',
  });
}

export async function exportCustomerStatement(o: StatementOptions): Promise<void> {
  await ensureFonts();

  const pages = chunk(o.transactions, ROWS_PER_PAGE);
  if (pages.length === 0) pages.push([]);
  // The totals block needs room under the last table; if that page is nearly
  // full it would overflow the fixed-height page, so give totals their own.
  const totalsSpill = pages[pages.length - 1].length > ROWS_LEAVING_ROOM_FOR_TOTALS;
  if (totalsSpill) pages.push([]);
  const totalPages = pages.length;
  const issuedAt = stamp(new Date());

  // One canvas, reused for every page — allocating a 1240×1754 bitmap per page
  // is the other thing that used to make a long statement crawl.
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');

  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < totalPages; i++) {
    drawPage(ctx, o, pages[i], i + 1, totalPages, i === totalPages - 1, issuedAt);
    // JPEG, not PNG: a PNG of a full history ran to tens of MB of base64, which
    // is what the WhatsApp plugin then has to marshal across the bridge.
    const imgData = canvas.toDataURL('image/jpeg', 0.9);
    if (i > 0) pdf.addPage();
    pdf.addImage(imgData, 'JPEG', 0, 0, pageW, pageH);
  }
  canvas.width = 0; // release the backing bitmap now rather than waiting on GC
  canvas.height = 0;

  const filename = `كشف-${o.customer.name}-${Date.now()}.pdf`.replace(/\s+/g, '_');

  if (Capacitor.getPlatform() === 'web') {
    pdf.save(filename);
    return;
  }

  const base64 = pdf.output('datauristring').split(',')[1];

  // Native: hand the PDF to WhatsApp with the file attached. WhatsApp opens on
  // its "send to" screen so the grocer taps the target contact — WhatsApp's
  // public API can't both pre-select a chat AND attach a file, so the file is
  // what we guarantee. An ASCII filename keeps the plugin's sanitizer happy.
  const caption = `كشف حساب ${o.customer.name} — ${o.storeName || 'دفتر البقالة'}`;
  const sos = window.plugins?.socialsharing;
  if (sos?.shareViaWhatsApp) {
    try {
      await new Promise<void>((resolve, reject) => {
        sos.shareViaWhatsApp(
          caption,
          `df:statement.pdf;data:application/pdf;base64,${base64}`,
          null,
          () => resolve(),
          (err) => reject(new Error(err || 'whatsapp share failed')),
        );
      });
      return;
    } catch {
      // WhatsApp missing / user backed out — fall through to the system sheet
      // so the statement can still be shared some other way.
    }
  }

  // Fallback: write to cache and open the system share sheet.
  const written = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
  });
  await Share.share({ title: 'كشف حساب', url: written.uri });
}
