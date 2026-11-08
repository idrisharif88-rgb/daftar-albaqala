import { shareFileViaWhatsApp } from '../../lib/shareFile';
import { printPdf } from '../../lib/systemPrint';

// Shared plumbing for the POS PDFs (barcode labels, the day's report).
//
// Same approach as the customer statement: jsPDF cannot shape Arabic, so each
// page is PAINTED on a canvas (the WebView shapes the text) and placed in the
// PDF as an image. The page is A4 at 150 dpi.

export const FONT = 'Tajawal, sans-serif';
export const PAGE_W = 1240; // A4 width in px at 150 dpi
export const PAGE_H = 1754;
export const MARGIN = 59; // 10 mm

let fontsReady: Promise<void> | null = null;
/** Canvas silently falls back to a font without good Arabic until asked. */
export function ensureFonts(): Promise<void> {
  if (!fontsReady) {
    fontsReady = Promise.all([
      document.fonts.load(`400 24px ${FONT}`),
      document.fonts.load(`700 24px ${FONT}`),
    ]).then(() => undefined).catch(() => undefined);
  }
  return fontsReady;
}

/** A blank white page canvas, ready to draw on. */
export function newPage(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.fillStyle = '#000';
  return { canvas, ctx };
}

/** Break `text` into at most `maxLines` lines that fit `maxWidth` (between
 *  words); the last line is shortened with «…» if it still does not fit. */
export function wrapText(
  ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width <= maxWidth || !line) line = t;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}

/** The pages as one PDF (base64, no data: prefix). jsPDF loads on demand so it
 *  stays out of the startup bundle. */
export async function pdfFromPages(pages: HTMLCanvasElement[]): Promise<string> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  pages.forEach((c, i) => {
    if (i > 0) pdf.addPage();
    pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, w, h);
    c.width = 0; // release the bitmap now rather than waiting on GC
    c.height = 0;
  });
  return pdf.output('datauristring').split(',')[1];
}

/** Share the PDF: WhatsApp with the file attached, else the system share
 *  sheet; in a browser it downloads. */
export async function sharePdf(base64: string, filename: string, caption: string): Promise<void> {
  await shareFileViaWhatsApp({ data: base64, mime: 'application/pdf', filename, caption });
}

/** Android's print dialog (any printer the phone reaches, or «Save as PDF»). */
export async function printPdfFile(base64: string, jobName: string): Promise<void> {
  await printPdf(base64, jobName);
}
