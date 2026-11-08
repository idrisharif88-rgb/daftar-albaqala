import { getDayRows, getDayLock, type DayRow } from './stock';
import { getSettings, messageSender } from '../../data/settings';
import { sharePdf } from './pdfPages';
import {
  FONT, MARGIN, PAGE_H, PAGE_W, ensureFonts, newPage, pdfFromPages, wrapText,
} from './pdfPages';
import { totalsOf } from './stock';
import { formatMinor } from '../../data/money';

// One day's report as a PDF: what was baked, sold and left of each product,
// and the takings. For sharing the day with someone who does not open the app.

// Large and bold on purpose: this is read on paper or a phone, by someone
// glancing at it — not studied. A long name takes two lines.
const ROW_H = 72;
const ROW_H_2 = 116;
const HEAD_H = 72;
const TEXT = 38;
const HEAD_TEXT = 34;

export async function buildDayReportPdf(opts: {
  day: string;
  rows: DayRow[];
  shopName: string;
  /** «معتمد», «عُدِّل بعد الاعتماد ×N» — how firm the baked numbers are. */
  status?: string;
}): Promise<{ base64: string; filename: string }> {
  await ensureFonts();
  const rows = opts.rows.filter((r) => r.baked !== 0 || r.sold !== 0);
  const t = totalsOf(rows);

  // Columns, right to left: product | baked | sold | left | takings. The first
  // is the product's right edge; the rest are the CENTRES of their columns,
  // all inside the margins (the takings column is the narrowest).
  const right = PAGE_W - MARGIN;
  const colX = [right, right - 600, right - 725, right - 850, right - 1005];
  const nameW = 520;

  const pages: HTMLCanvasElement[] = [];
  let { canvas, ctx } = newPage();
  let y = MARGIN;

  const style = (size: number, bold = true) => {
    ctx.font = `${bold ? 700 : 400} ${size}px ${FONT}`;
    ctx.direction = 'rtl';
    ctx.textBaseline = 'top';
  };
  const header = () => {
    ctx.fillStyle = '#e3efe6';
    ctx.fillRect(MARGIN, y, PAGE_W - 2 * MARGIN, HEAD_H);
    ctx.fillStyle = '#000';
    style(HEAD_TEXT);
    const labels = ['المنتج', 'مخبوز', 'مباع', 'متبقي', 'الإيراد'];
    labels.forEach((l, i) => {
      ctx.textAlign = i === 0 ? 'right' : 'center';
      ctx.fillText(l, i === 0 ? colX[0] - 10 : colX[i], y + 17);
    });
    y += HEAD_H;
  };

  // Title block (first page only).
  style(58);
  ctx.textAlign = 'right';
  // The date is isolated left-to-right, or the right-to-left line shuffles its
  // year, month and day (2026-11-08 would read 08-11-2026).
  ctx.fillText(`تقرير يوم \u2066${opts.day}\u2069`, right, y);
  y += 80;
  style(36);
  if (opts.shopName) { ctx.fillText(opts.shopName, right, y); y += 50; }
  if (opts.status) { ctx.fillText(opts.status, right, y); y += 50; }
  style(38);
  ctx.fillText(
    `مخبوز ${t.baked}  ·  مباع ${t.sold}  ·  متبقي ${t.left}  ·  الإيراد ${formatMinor(t.revenue)}`,
    right, y,
  );
  y += 84;
  header();

  for (const r of rows) {
    style(TEXT);
    const lines = wrapText(ctx, r.product.name, nameW, 2);
    const rowH = lines.length > 1 ? ROW_H_2 : ROW_H;
    if (y + rowH > PAGE_H - MARGIN) {
      pages.push(canvas);
      ({ canvas, ctx } = newPage());
      y = MARGIN;
      header();
      style(TEXT);
    }
    const out = r.baked > 0 && r.left <= 0; // sold out: red
    ctx.fillStyle = out ? '#b3261e' : '#000';
    ctx.textAlign = 'right';
    ctx.direction = 'rtl';
    lines.forEach((l, i) => ctx.fillText(l, colX[0] - 10, y + 14 + i * 46));
    const mid = y + (rowH - TEXT) / 2 - 4; // numbers sit in the middle of the row
    ctx.textAlign = 'center';
    ctx.direction = 'ltr';
    ctx.fillText(String(r.baked), colX[1], mid);
    ctx.fillText(String(r.sold), colX[2], mid);
    ctx.fillText(String(r.left), colX[3], mid);
    ctx.fillText(formatMinor(r.revenue), colX[4], mid);
    ctx.fillStyle = '#999';
    ctx.fillRect(MARGIN, y + rowH - 2, PAGE_W - 2 * MARGIN, 2);
    ctx.fillStyle = '#000';
    y += rowH;
  }
  pages.push(canvas);
  return { base64: await pdfFromPages(pages), filename: `تقرير-${opts.day}.pdf` };
}

/** Build the report for `day` from the stored numbers and share it. */
export async function shareDayReport(day: string): Promise<void> {
  const [rows, lock, settings] = await Promise.all([getDayRows(day), getDayLock(day), getSettings()]);
  const status = lock.locked
    ? 'الكميات معتمدة' + (lock.reopened > 0 ? ` · عُدِّل بعد الاعتماد ×${lock.reopened}` : '')
    : undefined;
  const { base64, filename } = await buildDayReportPdf({
    day, rows, shopName: messageSender(settings), status,
  });
  await sharePdf(base64, filename, `تقرير يوم ${day}`);
}
