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

const ROW_H = 54;
const HEAD_H = 56;

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
  const colX = [right, right - 590, right - 730, right - 870, right - 1031];
  const nameW = 500;

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
    style(28);
    const labels = ['المنتج', 'مخبوز', 'مباع', 'متبقي', 'الإيراد'];
    labels.forEach((l, i) => {
      ctx.textAlign = i === 0 ? 'right' : 'center';
      ctx.fillText(l, i === 0 ? colX[0] - 10 : colX[i], y + 12);
    });
    y += HEAD_H;
  };

  // Title block (first page only).
  style(46);
  ctx.textAlign = 'right';
  // The date is isolated left-to-right, or the right-to-left line shuffles its
  // year, month and day (2026-11-08 would read 08-11-2026).
  ctx.fillText(`تقرير يوم \u2066${opts.day}\u2069`, right, y);
  y += 64;
  style(28, false);
  if (opts.shopName) { ctx.fillText(opts.shopName, right, y); y += 40; }
  if (opts.status) { ctx.fillText(opts.status, right, y); y += 40; }
  style(30);
  ctx.fillText(
    `مخبوز ${t.baked}  ·  مباع ${t.sold}  ·  متبقي ${t.left}  ·  الإيراد ${formatMinor(t.revenue)}`,
    right, y,
  );
  y += 64;
  header();

  for (const r of rows) {
    if (y + ROW_H > PAGE_H - MARGIN) {
      pages.push(canvas);
      ({ canvas, ctx } = newPage());
      y = MARGIN;
      header();
    }
    style(28, false);
    ctx.fillStyle = r.baked > 0 && r.left <= 0 ? '#b3261e' : '#000';
    ctx.textAlign = 'right';
    const name = wrapText(ctx, r.product.name, nameW, 1)[0] ?? '';
    ctx.fillText(name, colX[0] - 10, y + 12);
    ctx.textAlign = 'center';
    ctx.direction = 'ltr';
    ctx.fillText(String(r.baked), colX[1], y + 12);
    ctx.fillText(String(r.sold), colX[2], y + 12);
    ctx.fillText(String(r.left), colX[3], y + 12);
    ctx.fillText(formatMinor(r.revenue), colX[4], y + 12);
    ctx.fillStyle = '#ccc';
    ctx.fillRect(MARGIN, y + ROW_H - 2, PAGE_W - 2 * MARGIN, 2);
    ctx.fillStyle = '#000';
    y += ROW_H;
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
