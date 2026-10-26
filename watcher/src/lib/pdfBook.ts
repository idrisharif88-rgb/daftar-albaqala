import { jsPDF } from 'jspdf';
import type { BookExport, ExportedEntry } from './api';
import { ROLE_AR } from './format';
import { deliverFile, safeName, today } from './deliverFile';

// One account's whole book as a PDF — the readable copy, next to the
// spreadsheet (exportBook.ts). A grocer who asks for his data usually wants to
// LOOK at it; the spreadsheet is for whoever wants to sum it.
//
// Arabic in a PDF is the hard part: jsPDF cannot SHAPE Arabic — letters join,
// and the run reads right to left — so a text PDF comes out as disconnected
// letters in the wrong order. The way round it, the same one the shop app's
// statement uses, is to let the browser shape the text on a CANVAS and put the
// result into the PDF as an image. The output is therefore a bitmap on
// purpose: not selectable, but correct, which is the trade a document people
// treat as official has to make.
//
// Each page is painted with fillText/fillRect rather than rendered from HTML:
// no DOM, no CSS cascade, no layout pass, so a page costs milliseconds.

// A4 at ~150dpi, so the text stays crisp on paper.
const PAGE_W = 1240;
const PAGE_H = Math.round((PAGE_W * 297) / 210); // 1754
const MARGIN = 60;
const CONTENT_W = PAGE_W - MARGIN * 2;

const HEADER_H = 240;   // the block at the top of every page
const FOOTER_H = 70;
const ROW_H = 46;
const HEAD_H = 52;
const TITLE_H = 64;
const BODY_TOP = HEADER_H;
const BODY_BOTTOM = PAGE_H - FOOTER_H;

const FONT = 'Tajawal, sans-serif';
const GREEN = '#1b5e20';
const RED = '#c0392b';
const INK = '#222222';
const MUTED = '#777777';
const LINE = '#dddddd';
const ZEBRA = '#f7f9f7';

const CURRENCY_AR: Record<string, string> = {
  YER: 'ريال', SAR: 'ر.س', USD: '$', GOLD: 'جرام ذهب',
};
const currencyAr = (code: string) => CURRENCY_AR[code] ?? code;
const money = (amount: number, currency: string) =>
  `${Math.abs(amount).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currencyAr(currency)}`;

type Ctx = CanvasRenderingContext2D;

interface Column { title: string; width: number; rtl?: boolean }

// Laid out RIGHT to LEFT — the first entry is the rightmost column, which is
// where an Arabic reader starts.
const CONTACT_COLUMNS: Column[] = [
  { title: 'الاسم', width: 300 },
  { title: 'الهاتف', width: 210, rtl: false },
  { title: 'الصفة', width: 170 },
  { title: 'الرصيد', width: 320 },
  { title: 'الحركات', width: CONTENT_W - 1000, rtl: false },
];

// The note is given what is left, and it needs it: an invoice entry's note
// carries the whole basket («فاتورة رقم 12: جبن ×3، سكر ×2، …»), so a narrow
// column would clip every one of them to nothing.
const ENTRY_COLUMNS: Column[] = [
  { title: 'التاريخ', width: 210, rtl: false },
  { title: 'الجهة', width: 230 },
  { title: 'النوع', width: 120 },
  { title: 'المبلغ', width: 200 },
  { title: 'ملاحظة', width: CONTENT_W - 760 },
];

/** Centre and width of each column, computed once, right to left. */
function layout(columns: Column[]) {
  let right = PAGE_W - MARGIN;
  return columns.map((c) => {
    const centre = right - c.width / 2;
    right -= c.width;
    return { ...c, centre };
  });
}
const CONTACT_LAYOUT = layout(CONTACT_COLUMNS);
const ENTRY_LAYOUT = layout(ENTRY_COLUMNS);

/**
 * A timestamp as «2026-10-24 18:47».
 *
 * NOT toLocaleString('ar'): that returns Arabic-Indic digits wrapped in
 * direction marks, and canvas resolves those against the surrounding run — in
 * a table cell the day, month and time come out in a scrambled order.
 */
function stamp(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// The @font-face is declared in CSS, but a font is only actually loaded once
// something needs it — and canvas silently falls back to a default (which does
// not carry Arabic well) if it isn't ready. So ask for it explicitly, once.
let fontsReady: Promise<void> | null = null;
function ensureFonts(): Promise<void> {
  if (!fontsReady) {
    fontsReady = Promise.all([
      document.fonts.load(`400 26px ${FONT}`),
      document.fonts.load(`700 26px ${FONT}`),
    ]).then(() => undefined).catch(() => undefined);
  }
  return fontsReady;
}

interface TextOpts {
  size?: number; bold?: boolean; color?: string;
  rtl?: boolean; align?: CanvasTextAlign; maxWidth?: number;
}

function text(ctx: Ctx, value: string, x: number, y: number, o: TextOpts = {}): void {
  ctx.font = `${o.bold ? 700 : 400} ${o.size ?? 24}px ${FONT}`;
  ctx.fillStyle = o.color ?? INK;
  ctx.textAlign = o.align ?? 'center';
  ctx.textBaseline = 'middle';
  // Direction decides bidi resolution: Arabic cells read right-to-left, while
  // a date or a phone number must stay left-to-right or the digits reverse.
  ctx.direction = o.rtl === false ? 'ltr' : 'rtl';
  ctx.fillText(o.maxWidth ? clip(ctx, value, o.maxWidth) : value, x, y);
}

/** Trim to fit the column rather than letting a long note run into the next. */
function clip(ctx: Ctx, value: string, maxWidth: number): string {
  if (ctx.measureText(value).width <= maxWidth) return value;
  let cut = value;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function hline(ctx: Ctx, y: number, color = LINE): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y);
  ctx.lineTo(PAGE_W - MARGIN, y);
  ctx.stroke();
}

// ---- The document as a flat list of blocks, flowed onto pages ----
//
// Two tables of unknown length follow one another, so the page breaks cannot be
// worked out per table. Everything becomes one list of blocks with a known
// height and the list is poured into pages; a section heading and its column
// header are kept with at least one row, so no page ends on a heading alone.

type Block =
  | { kind: 'title'; label: string; height: number }
  | { kind: 'head'; cols: ReturnType<typeof layout>; height: number }
  | { kind: 'row'; cols: ReturnType<typeof layout>; cells: (string | null)[];
      opts: TextOpts[]; zebra: boolean; height: number }
  | { kind: 'empty'; label: string; height: number };

const title = (label: string): Block => ({ kind: 'title', label, height: TITLE_H });
const head = (cols: ReturnType<typeof layout>): Block => ({ kind: 'head', cols, height: HEAD_H });
const empty = (label: string): Block => ({ kind: 'empty', label, height: ROW_H });

function buildBlocks(book: BookExport): Block[] {
  const blocks: Block[] = [];

  // debt − payment per currency, per contact.
  const balances = new Map<string, Map<string, number>>();
  const counts = new Map<string, number>();
  for (const t of book.transactions) {
    const row = balances.get(t.customer_id) ?? new Map<string, number>();
    row.set(t.currency, (row.get(t.currency) ?? 0) + (t.type === 'debt' ? t.amount : -t.amount));
    balances.set(t.customer_id, row);
    counts.set(t.customer_id, (counts.get(t.customer_id) ?? 0) + 1);
  }

  blocks.push(title(`الجهات (${book.customers.length})`), head(CONTACT_LAYOUT));
  if (book.customers.length === 0) blocks.push(empty('لا توجد جهات'));
  book.customers.forEach((c, i) => {
    const bal = balances.get(c.id);
    // Nothing is converted between currencies — the rates live on the grocer's
    // own phone and are deliberately not synced — so each one is named.
    const balText = !bal || bal.size === 0 ? 'مسدد'
      : [...bal].filter(([, v]) => v !== 0)
          .map(([code, v]) => `${money(v, code)} ${v > 0 ? 'عليه' : 'له'}`).join(' · ') || 'مسدد';
    blocks.push({
      kind: 'row', cols: CONTACT_LAYOUT, zebra: i % 2 === 1, height: ROW_H,
      cells: [c.name, c.phone, ROLE_AR[c.role] ?? c.role, balText, String(counts.get(c.id) ?? 0)],
      opts: [
        { size: 23, bold: true },
        { size: 21, rtl: false, color: MUTED },
        { size: 21 },
        { size: 22 },
        { size: 21, rtl: false, color: MUTED },
      ],
    });
  });

  blocks.push(title(`الحركات (${book.transactions.length})`), head(ENTRY_LAYOUT));
  if (book.transactions.length === 0) blocks.push(empty('لا توجد حركات'));
  const nameById = new Map(book.customers.map((c) => [c.id, c.name]));
  book.transactions.forEach((t: ExportedEntry, i) => {
    // «دين» / «تسديد», the ledger's own wording — not the role-dependent Arabic
    // the shop app shows its owner. A book here is read across mixed roles at
    // once, and this is already how the Watcher speaks on screen.
    const isDebt = t.type === 'debt';
    blocks.push({
      kind: 'row', cols: ENTRY_LAYOUT, zebra: i % 2 === 1, height: ROW_H,
      cells: [stamp(t.occurred_at), nameById.get(t.customer_id) ?? '—',
        isDebt ? 'دين' : 'تسديد', money(t.amount, t.currency), (t.note ?? '').trim()],
      opts: [
        { size: 20, rtl: false, color: MUTED },
        { size: 22 },
        { size: 22, bold: true, color: isDebt ? RED : GREEN },
        { size: 22, bold: true },
        { size: 20, color: MUTED },
      ],
    });
  });

  return blocks;
}

/** Pour the blocks into pages, keeping a heading with what follows it. */
function paginate(blocks: Block[]): Block[][] {
  const pages: Block[][] = [];
  let page: Block[] = [];
  let y = BODY_TOP;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // A title is followed by its column header and at least one row; if those
    // three do not fit, start the page now rather than orphan the heading.
    const keep = b.kind === 'title'
      ? b.height + (blocks[i + 1]?.height ?? 0) + (blocks[i + 2]?.height ?? 0)
      : b.height;
    if (y + keep > BODY_BOTTOM && page.length > 0) {
      pages.push(page);
      page = [];
      y = BODY_TOP;
    }
    page.push(b);
    y += b.height;
  }
  if (page.length > 0) pages.push(page);
  return pages.length > 0 ? pages : [[]];
}

function drawPageHeader(ctx: Ctx, book: BookExport, issuedAt: string): void {
  const who = book.account.store_name || book.account.phone;
  text(ctx, who, PAGE_W / 2, 84, { size: 42, bold: true, color: GREEN });
  text(ctx, `نسخة من ${book.book_label ?? 'الدفتر'}`, PAGE_W / 2, 138, { size: 26, color: MUTED });
  const right = PAGE_W - MARGIN;
  text(ctx, `الهاتف: ${book.account.phone}`, right, 190, { size: 22, align: 'right' });
  text(ctx, `تاريخ الإصدار: ${issuedAt}`, MARGIN, 190, { size: 22, align: 'left' });
  hline(ctx, 214);
}

function drawPage(
  ctx: Ctx, book: BookExport, blocks: Block[], pageNo: number, total: number, issuedAt: string,
): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  drawPageHeader(ctx, book, issuedAt);

  let y = BODY_TOP;
  for (const b of blocks) {
    if (b.kind === 'title') {
      text(ctx, b.label, PAGE_W - MARGIN, y + b.height / 2, {
        size: 30, bold: true, color: GREEN, align: 'right',
      });
    } else if (b.kind === 'head') {
      ctx.fillStyle = GREEN;
      ctx.fillRect(MARGIN, y, CONTENT_W, b.height);
      for (const col of b.cols) {
        text(ctx, col.title, col.centre, y + b.height / 2, {
          size: 23, bold: true, color: '#ffffff',
        });
      }
    } else if (b.kind === 'empty') {
      text(ctx, b.label, PAGE_W / 2, y + b.height / 2, { size: 23, color: MUTED });
    } else {
      if (b.zebra) {
        ctx.fillStyle = ZEBRA;
        ctx.fillRect(MARGIN, y, CONTENT_W, b.height);
      }
      b.cols.forEach((col, idx) => {
        const value = b.cells[idx];
        if (value) {
          text(ctx, value, col.centre, y + b.height / 2, {
            ...b.opts[idx], maxWidth: col.width - 16,
          });
        }
      });
      hline(ctx, y + b.height);
    }
    y += b.height;
  }

  text(ctx, `صفحة ${pageNo} من ${total}`, PAGE_W / 2, PAGE_H - 40, { size: 20, color: '#999999' });
}

export async function exportBookToPdf(book: BookExport): Promise<void> {
  await ensureFonts();
  const pages = paginate(buildBlocks(book));
  const issuedAt = stamp(new Date());

  // One canvas, reused for every page — allocating a 1240×1754 bitmap per page
  // is what makes a long book crawl.
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('تعذّر إنشاء الملف على هذا الجهاز.');

  const pdf = new jsPDF('p', 'mm', 'a4');
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  for (let i = 0; i < pages.length; i++) {
    drawPage(ctx, book, pages[i], i + 1, pages.length, issuedAt);
    // JPEG, not PNG: a PNG of a long book runs to tens of MB of base64, which
    // is then marshalled across the native bridge.
    if (i > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, w, h);
  }
  canvas.width = 0; // release the backing bitmap now rather than waiting on GC
  canvas.height = 0;

  const who = safeName(book.account.store_name || book.account.phone) || 'حساب';
  await deliverFile(
    pdf.output('datauristring').split(',')[1],
    `${safeName(book.book_label ?? 'دفتر')}-${who}-${today()}.pdf`,
    `${book.book_label ?? 'دفتر'} — ${who}`,
  );
}
