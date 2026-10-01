import { formatMinor } from '../data/money';
import { currencyDef, totalInBase, type Rates } from '../data/currencies';
import { tafqeetBaseMinor } from './tafqeet';

// Renders a purchase as an 80mm thermal receipt and turns it into the bytes an
// ESC/POS printer understands.
//
// The receipt is drawn as a PICTURE, not as text, and that is the whole design.
// A thermal printer prints text from its own built-in character sets, and the
// cheap ones sold here have no Arabic set at all — sending «سكر» as text prints
// mojibake or nothing. Even the printers that do carry Arabic store it in
// isolated letterforms, so words come out unjoined and in the wrong order. So
// the WebView — which shapes Arabic correctly, and is already doing it on every
// screen of this app — draws the receipt onto a canvas, and we send the printer
// a bitmap. It is the same reasoning as the PDF statement (see pdf.ts).

/** One line of a purchase. Money is in INTEGER minor units throughout. */
export interface InvoiceLine {
  name: string;
  qty: number;
  unitPrice: number;
  currency: string;
  total: number;
}

export interface ReceiptOptions {
  storeName: string;
  contactName: string;
  /** «صاحب متجر» / «زبون» / «شريك» — what this contact is. */
  roleLabel: string;
  /** What this entry is called for that role, e.g. «تسجيل دين». */
  entryLabel: string;
  /** «رقم الفاتورة» — how the two sides refer to this basket afterwards. */
  number: number;
  lines: InvoiceLine[];
  total: number;
  currency: string;
  issuedAt: Date;
  rates: Rates;
}

// 80mm paper prints 576 dots wide on essentially every ESC/POS unit (72mm of
// printable area at 203dpi). It must be a multiple of 8: the raster format
// packs 8 pixels into a byte and a partial byte would shear every row.
export const PAPER_DOTS = 576;

const FONT = 'Tajawal, sans-serif';
const MARGIN = 12;

// Vertical rhythm, in dots.
const LINE_H = 38;
const ROW_H = 42;
const GAP = 14;

let fontsReady: Promise<void> | null = null;
function ensureFonts(): Promise<void> {
  if (!fontsReady) {
    // A font is only really loaded once something asks for it, and canvas
    // silently falls back to a default that does not carry Arabic well.
    fontsReady = Promise.all([
      document.fonts.load(`400 24px ${FONT}`),
      document.fonts.load(`700 24px ${FONT}`),
    ]).then(() => undefined).catch(() => undefined);
  }
  return fontsReady;
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}`;
}

interface TextOpts {
  size?: number;
  align?: CanvasTextAlign;
  rtl?: boolean;
  maxWidth?: number;
}

function text(
  ctx: CanvasRenderingContext2D, value: string, x: number, y: number, o: TextOpts = {},
): void {
  // EVERY line bold. On paper the regular weight came out thin and grey next
  // to the bold headings — the owner could read the store name and the total
  // and little else. A thermal head prints one bit per dot, where a thin
  // stroke breaks up entirely, so bold is the only weight that survives both.
  ctx.font = `700 ${o.size ?? 26}px ${FONT}`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = o.align ?? 'right';
  ctx.textBaseline = 'middle';
  // Arabic runs right-to-left; a bare number or a date must stay left-to-right
  // or its digits come out reversed.
  ctx.direction = o.rtl === false ? 'ltr' : 'rtl';
  ctx.fillText(o.maxWidth ? clip(ctx, value, o.maxWidth) : value, x, y);
}

function clip(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  if (ctx.measureText(value).width <= maxWidth) return value;
  let cut = value;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function rule(ctx: CanvasRenderingContext2D, y: number, dashed = false): void {
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.setLineDash(dashed ? [6, 6] : []);
  ctx.beginPath();
  ctx.moveTo(MARGIN, y);
  ctx.lineTo(PAPER_DOTS - MARGIN, y);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** How tall the receipt will be, so the canvas is allocated once at the right
 *  size — a thermal receipt is a single continuous strip, never paged. */
// The item name's column: whatever the three numeric columns leave it.
const NAME_W = PAPER_DOTS - 340;
const ITEM_SIZE = 26;
// The smallest an item name shrinks to before it is allowed a second line —
// still bold, still the size of the old headings that read fine on paper.
const ITEM_MIN_SIZE = 21;
// The extra drop for an item name's second line.
const WRAP_H = 28;

interface FittedName {
  size: number;
  lines: string[];
}

/**
 * Fit an item name to its column. First by SHRINKING it, a point at a time,
 * down to ITEM_MIN_SIZE — the owner's call: «بطاطس نعمان أبو 50» should stay
 * on one line in slightly smaller letters rather than break in two. Only a
 * name too long even at that size gets a second line, broken between words;
 * past two lines, the second is clipped like any other overlong text.
 */
function fitName(name: string): FittedName {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return { size: ITEM_SIZE, lines: [name] };
  for (let size = ITEM_SIZE; size >= ITEM_MIN_SIZE; size--) {
    ctx.font = `700 ${size}px ${FONT}`;
    if (ctx.measureText(name).width <= NAME_W) return { size, lines: [name] };
  }
  // Still too wide at the smallest size: two lines at that size.
  const words = name.split(/\s+/);
  let first = '';
  let i = 0;
  for (; i < words.length; i++) {
    const next = first ? `${first} ${words[i]}` : words[i];
    if (ctx.measureText(next).width > NAME_W) break;
    first = next;
  }
  // One word wider than the column: nothing to break at, so it is clipped.
  if (!first || i >= words.length) return { size: ITEM_MIN_SIZE, lines: [name] };
  return { size: ITEM_MIN_SIZE, lines: [first, words.slice(i).join(' ')] };
}

function measure(o: ReceiptOptions, wrappedRows: number): number {
  const base = 60 + LINE_H * 5 + GAP * 4 + ROW_H + 30; // header + column heads
  const rows = o.lines.length * ROW_H + wrappedRows * WRAP_H;
  const totals = GAP + ROW_H + LINE_H * 2 + GAP * 2 + 70; // total, words, footer
  return base + rows + totals;
}

/** Draw the receipt and hand back the canvas. Exported for the preview on the
 *  screen: seeing what will print beats discovering it on paper. */
export async function renderReceipt(o: ReceiptOptions, scale = 1): Promise<HTMLCanvasElement> {
  await ensureFonts();

  // `scale` draws the SAME layout at a higher resolution — 1.5 for an ordinary
  // printer, where the receipt prints larger and enlarging a 576-dot image
  // would only make blurrier letters. A thermal printer must get exactly
  // PAPER_DOTS, so it always renders at 1. Sizes are rounded UP: a canvas is
  // whole pixels, and a fractional scale must not shave off the bottom row.
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(PAPER_DOTS * scale);
  const names = o.lines.map((l) => fitName(l.name));
  const wrapped = names.filter((n) => n.lines.length > 1).length;
  canvas.height = Math.ceil(measure(o, wrapped) * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('تعذّر تجهيز الفاتورة');

  // White ground: anything left transparent thresholds to black and the
  // printer would burn the whole strip.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);

  const right = PAPER_DOTS - MARGIN;
  const left = MARGIN;
  const centre = PAPER_DOTS / 2;
  let y = 34;

  text(ctx, o.storeName || 'دفتر البقالة', centre, y, { size: 34, align: 'center' });
  y += LINE_H + 6;
  text(ctx, o.entryLabel, centre, y, { size: 28, align: 'center' });
  y += LINE_H;

  rule(ctx, y);
  y += GAP + 6;

  text(ctx, `${o.roleLabel}: ${o.contactName}`, right, y, { size: 26, maxWidth: PAPER_DOTS - 40 });
  y += LINE_H;
  text(ctx, `رقم الفاتورة: ${o.number}`, right, y, { size: 26 });
  y += LINE_H;
  text(ctx, `التاريخ: ${stamp(o.issuedAt)}`, right, y, { size: 26 });
  y += LINE_H;

  rule(ctx, y, true);
  y += GAP + 4;

  // Columns, right to left: الصنف | الكمية | السعر | الإجمالي
  const colTotal = left + 90;
  const colPrice = left + 210;
  const colQty = left + 290;
  text(ctx, 'الصنف', right, y, { size: 26 });
  text(ctx, 'كمية', colQty, y, { size: 26, align: 'center' });
  text(ctx, 'سعر', colPrice, y, { size: 26, align: 'center' });
  text(ctx, 'إجمالي', colTotal, y, { size: 26, align: 'center' });
  y += 28;
  rule(ctx, y);
  y += ROW_H - 8;

  for (const [i, l] of o.lines.entries()) {
    // The name gets whatever room the three numeric columns leave it.
    const { size: nameSize, lines: [nameTop, nameRest] } = names[i];
    text(ctx, nameTop, right, y, { size: nameSize, maxWidth: NAME_W });
    text(ctx, String(l.qty), colQty, y, { size: 26, align: 'center', rtl: false });
    text(ctx, formatMinor(l.unitPrice), colPrice, y, { size: 26, align: 'center', rtl: false });
    text(ctx, formatMinor(l.total), colTotal, y, { size: 26, align: 'center', rtl: false });
    if (nameRest) {
      y += WRAP_H;
      text(ctx, nameRest, right, y, { size: nameSize, maxWidth: NAME_W });
    }
    y += ROW_H;
  }

  rule(ctx, y);
  y += GAP + 10;

  const short = currencyDef(o.currency).shortAr;
  text(ctx, `الإجمالي: ${formatMinor(o.total)} ${short}`, right, y, { size: 32 });
  y += ROW_H;

  // A foreign-currency purchase also shows what it is worth in riyals today —
  // the native figure stays the debt of record.
  const { minor: inBase, complete } = totalInBase(
    [{ currency: o.currency as never, minor: o.total }], o.rates,
  );
  if (complete && currencyDef(o.currency).isBase === false) {
    text(ctx, `≈ ${formatMinor(inBase)} ريال بأسعار اليوم`, right, y, { size: 24 });
    y += LINE_H;
  }

  // The total in words, the way a receipt or a cheque does it: words are the
  // check on the figure when a printed digit smudges or is misread.
  if (currencyDef(o.currency).isBase) {
    text(ctx, `فقط ${tafqeetBaseMinor(o.total)} لا غير`, right, y, {
      size: 24, maxWidth: PAPER_DOTS - 24,
    });
    y += LINE_H;
  }

  y += GAP;
  rule(ctx, y, true);
  y += GAP + 10;
  text(ctx, 'دفتر البقالة', centre, y, { size: 24, align: 'center' });

  return canvas;
}

// ---- ESC/POS ----

const ESC = 0x1b;
const GS = 0x1d;

// Rows per raster command. Many cheap printers choke on one enormous GS v 0 —
// their input buffer is a few kilobytes — so the image goes down in bands.
const BAND_ROWS = 128;

/** A pixel is ink if it is dark OR meaningfully transparent. Thermal printing
 *  is one bit: there is no grey, so everything must fall to one side. */
function isInk(data: Uint8ClampedArray, i: number): boolean {
  const alpha = data[i + 3];
  if (alpha < 128) return false;
  const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return luma < 160;
}

/**
 * Canvas → ESC/POS bytes: initialise, then the bitmap in bands, then feed and
 * cut. `GS v 0` takes the row width in BYTES, which is why the canvas width
 * must be a multiple of 8.
 */
export function canvasToEscPos(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('تعذّر تجهيز الفاتورة');
  const { width, height } = canvas;
  const bytesPerRow = Math.ceil(width / 8);
  const image = ctx.getImageData(0, 0, width, height).data;

  const out: number[] = [];
  out.push(ESC, 0x40); // ESC @ — reset to a known state

  for (let bandTop = 0; bandTop < height; bandTop += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, height - bandTop);
    // GS v 0 m xL xH yL yH
    out.push(GS, 0x76, 0x30, 0x00,
      bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
      rows & 0xff, (rows >> 8) & 0xff);

    for (let row = 0; row < rows; row++) {
      const yy = bandTop + row;
      for (let byte = 0; byte < bytesPerRow; byte++) {
        let bits = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = byte * 8 + bit;
          if (x >= width) continue;
          const idx = (yy * width + x) * 4;
          // MSB is the leftmost pixel; 1 means burn.
          if (isInk(image, idx)) bits |= 0x80 >> bit;
        }
        out.push(bits);
      }
    }
  }

  // Feed the paper clear of the head before cutting, or the cut lands in the
  // middle of the last printed line.
  out.push(ESC, 0x64, 0x04);   // ESC d 4 — feed 4 lines
  out.push(GS, 0x56, 0x42, 0x00); // GS V B 0 — partial cut (ignored if none fitted)

  return new Uint8Array(out);
}
