import JsBarcode from 'jsbarcode';
import type { PosProduct } from './products';
import {
  FONT, MARGIN, PAGE_H, PAGE_W, ensureFonts, newPage, pdfFromPages, wrapText,
} from './pdfPages';
import { localDay } from './day';

// The barcode labels as a PDF — for sharing (WhatsApp, a print shop, a friend
// with a printer) or the phone's print dialog, when the printer cannot be
// reached from here. Same sheet as the browser one: three across, a dashed
// cutting line shared between neighbours, blank paper around every barcode.

const COLS = 3;
const CELL_W = Math.floor((PAGE_W - 2 * MARGIN) / COLS);
const PAD_X = 50;
const PAD_Y = 50;
const NAME_SIZE = 32;
const NAME_LINE = 42;
const NAME_LINES = 2;
const BAR_W = CELL_W - 2 * PAD_X;

/** The barcode drawn by JsBarcode on its own small canvas. */
function barcodeCanvas(code: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  JsBarcode(c, code, {
    format: 'EAN13', margin: 0, width: 3, height: 110,
    displayValue: true, fontSize: 30, textMargin: 6, font: 'monospace',
  });
  return c;
}

export async function buildLabelsPdf(products: PosProduct[]): Promise<{ base64: string; filename: string }> {
  await ensureFonts();
  // Every barcode has the same proportions, so one row height fits them all.
  const probe = barcodeCanvas(products[0]?.code ?? '2000000000008');
  const barH = Math.round(BAR_W * (probe.height / probe.width));
  const cellH = PAD_Y + barH + 14 + NAME_LINES * NAME_LINE + PAD_Y;
  const rows = Math.max(1, Math.floor((PAGE_H - 2 * MARGIN) / cellH));
  const perPage = rows * COLS;

  const pages: HTMLCanvasElement[] = [];
  for (let start = 0; start < Math.max(products.length, 1); start += perPage) {
    const { canvas, ctx } = newPage();
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.direction = 'rtl';
    ctx.font = `700 ${NAME_SIZE}px ${FONT}`;

    products.slice(start, start + perPage).forEach((p, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      // Right to left, like the browser sheet.
      const x = MARGIN + (COLS - 1 - col) * CELL_W;
      const y = MARGIN + row * cellH;
      ctx.strokeRect(x, y, CELL_W, cellH);
      ctx.drawImage(barcodeCanvas(p.code), x + PAD_X, y + PAD_Y, BAR_W, barH);
      const lines = wrapText(ctx, p.name, BAR_W, NAME_LINES);
      lines.forEach((l, k) => {
        ctx.fillText(l, x + CELL_W / 2, y + PAD_Y + barH + 14 + k * NAME_LINE);
      });
    });
    pages.push(canvas);
  }
  return { base64: await pdfFromPages(pages), filename: `ملصقات-${localDay()}.pdf` };
}
