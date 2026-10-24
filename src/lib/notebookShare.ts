import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import type { Note } from '../data/updatesNotebook';
import { classifyShareError } from './shareTarget';

// Sharing «دفتر التحديثات» notes — as text or as a PDF, all of them or the ones
// picked. Copied from «خماسيات». The PDF is drawn on a canvas in the app's own
// font for the same reason as the statement (pdf.ts): jsPDF cannot shape
// Arabic, the WebView can.

const TITLE = 'دفتر التحديثات';
const dateText = (ts: number) =>
  new Date(ts).toLocaleDateString('ar-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });

export function notesToText(notes: Note[]): string {
  const body = notes.map((n, i) => {
    const head = `${i + 1}. ${n.done ? '✓ ' : ''}${n.title}`.trim();
    return n.text ? `${head}\n${n.text}` : head;
  });
  return `${TITLE}\n\n${body.join('\n\n')}`;
}

export async function shareNotesText(notes: Note[]): Promise<void> {
  const text = notesToText(notes);
  if (Capacitor.isNativePlatform()) {
    await Share.share({ title: TITLE, text }).catch(() => undefined);
    return;
  }
  if (navigator.share) {
    await navigator.share({ title: TITLE, text }).catch(() => undefined);
    return;
  }
  await navigator.clipboard?.writeText(text).catch(() => undefined);
}

// ---- PDF: A4 pages drawn on a canvas ----
const PAGE_W = 1240;
const PAGE_H = 1754;
const MARGIN = 90;
const TOP = 120;
const BOTTOM = PAGE_H - 110;
const WIDTH = PAGE_W - MARGIN * 2;

const FONTS = {
  head: 'bold 46px Tajawal',
  title: 'bold 32px Tajawal',
  text: '27px Tajawal',
  small: '22px Tajawal',
};
const LINE_H = { title: 52, text: 46 };
const NOTE_GAP = 34;
const INK = '#1a1a1a';
const MUTED = '#6b7280';
const ACCENT = '#1b5e20';

type Row = { kind: 'title' | 'text'; text: string; done: boolean } | { kind: 'gap' };

async function preloadFonts(): Promise<void> {
  if (!document.fonts) return;
  try {
    await Promise.all(Object.values(FONTS).map((f) => document.fonts.load(f)));
    await document.fonts.ready;
  } catch {
    // Draw with whatever is there.
  }
}

// Wrap a paragraph to the page width; a word longer than a line is cut by letters.
function wrap(ctx: CanvasRenderingContext2D, paragraph: string): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of paragraph.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= WIDTH) { line = candidate; continue; }
    if (line) lines.push(line);
    line = word;
    while (ctx.measureText(line).width > WIDTH) {
      let cut = line.length - 1;
      while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > WIDTH) cut -= 1;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  lines.push(line);
  return lines;
}

function layoutNotes(ctx: CanvasRenderingContext2D, notes: Note[]): Row[] {
  const rows: Row[] = [];
  notes.forEach((n, i) => {
    ctx.font = FONTS.title;
    const head = `${i + 1}. ${n.done ? '✓ ' : ''}${n.title}`.trim();
    wrap(ctx, head).forEach((text) => rows.push({ kind: 'title', text, done: n.done }));
    ctx.font = FONTS.text;
    if (n.text) {
      n.text.split('\n').forEach((p) =>
        wrap(ctx, p).forEach((text) => rows.push({ kind: 'text', text, done: n.done })));
    }
    rows.push({ kind: 'gap' });
  });
  return rows;
}

const rowHeight = (row: Row) => (row.kind === 'gap' ? NOTE_GAP : LINE_H[row.kind]);

function paginate(rows: Row[]): Row[][] {
  const firstTop = TOP + 110; // under the first page's heading
  const pages: Row[][] = [[]];
  let y = firstTop;
  rows.forEach((row) => {
    if (y + rowHeight(row) > BOTTOM && row.kind !== 'gap') {
      pages.push([]);
      y = TOP;
    }
    pages[pages.length - 1].push(row);
    y += rowHeight(row);
  });
  return pages;
}

function drawPage(rows: Row[], pageNo: number, pageCount: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('تعذّر تجهيز الملف');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.direction = 'rtl';

  let y = TOP;
  if (pageNo === 1) {
    ctx.textAlign = 'center';
    ctx.fillStyle = ACCENT;
    ctx.font = FONTS.head;
    ctx.fillText(TITLE, PAGE_W / 2, y + 30);
    ctx.fillStyle = MUTED;
    ctx.font = FONTS.small;
    ctx.fillText(dateText(Date.now()), PAGE_W / 2, y + 74);
    y += 110;
  }

  ctx.textAlign = 'right';
  rows.forEach((row) => {
    if (row.kind !== 'gap') {
      ctx.font = FONTS[row.kind];
      ctx.fillStyle = row.done ? MUTED : (row.kind === 'title' ? ACCENT : INK);
      ctx.fillText(row.text, PAGE_W - MARGIN, y + LINE_H[row.kind] - 14);
    }
    y += rowHeight(row);
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = '#999999';
  ctx.font = FONTS.small;
  ctx.fillText(`صفحة ${pageNo} من ${pageCount}`, PAGE_W / 2, PAGE_H - 50);
  return canvas;
}

export async function shareNotesPdf(notes: Note[]): Promise<void> {
  await preloadFonts();
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('تعذّر تجهيز الملف');
  const pages = paginate(layoutNotes(measure, notes));

  // Loaded on demand — jspdf stays out of the startup bundle.
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  pages.forEach((rows, i) => {
    if (i > 0) pdf.addPage();
    const canvas = drawPage(rows, i + 1, pages.length);
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
  });

  const filename = `${TITLE}.pdf`;
  if (Capacitor.getPlatform() === 'web') {
    pdf.save(filename);
    return;
  }
  const written = await Filesystem.writeFile({
    path: filename,
    data: pdf.output('datauristring').split(',')[1],
    directory: Directory.Cache,
  });
  try {
    await Share.share({ title: TITLE, url: written.uri });
  } catch (err) {
    throw classifyShareError(err);
  }
}
