import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { formatMinor } from '../data/money';
import type { Customer } from '../data/customers';
import type { Transaction } from '../data/transactions';

// Per-customer PDF statement. Arabic in PDF is the hard part: jsPDF can't shape
// Arabic letters (joining/RTL), so instead we render a styled HTML report into
// an off-screen node, snapshot it to a canvas with html2canvas (the webview
// shapes Arabic correctly), and embed that image in the PDF. The file is
// image-based (not selectable text) but renders perfectly.
//
// The report is chunked into A4-sized pages and each page is snapshotted on its
// own. Rendering the whole history as one tall node froze the app on customers
// with many transactions: the canvas grew past what the Android WebView can
// hold, and encoding it blocked the UI thread for many seconds. Per-page
// canvases stay a bounded size no matter how long the history is.
//
// On native (Android) the PDF is sent to WhatsApp with the file attached — the
// grocer then picks which customer to send it to (WhatsApp's public API can't
// auto-open a specific chat AND attach a file; see the WhatsApp share note in
// exportCustomerStatement). If WhatsApp isn't installed we fall back to the
// system share sheet. On web it just downloads.

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
  currency: string;
  periodLabel: string;
}

// Page geometry. PAGE_W/PAGE_H keep the CSS pixel box at A4 proportions
// (210×297mm) so each snapshot fills exactly one PDF page with no distortion.
const PAGE_W = 760;
const PAGE_H = Math.round((PAGE_W * 297) / 210); // 1075
const ROWS_PER_PAGE = 16;
// Rows the totals block displaces on the last page; past this it gets its own.
const ROWS_LEAVING_ROOM_FOR_TOTALS = 13;
// scale 1.5 is legible on paper and on screen; scale 2 doubled canvas memory
// for no visible gain.
const CANVAS_SCALE = 1.5;
const JPEG_QUALITY = 0.9;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

const td = 'padding:8px;border:1px solid #ddd;text-align:center;';

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Pages are a fixed height, so a row must have a bounded height too — a long
// note wrapping over several lines would push the last rows off the page.
function shortNote(note: string | null | undefined): string {
  const n = (note ?? '').trim();
  return n.length > 44 ? `${n.slice(0, 43)}…` : n;
}

function rowsHtml(txns: Transaction[], currency: string): string {
  return txns
    .map((t) => `
      <tr>
        <td style="${td}">${esc(new Date(t.occurred_at).toLocaleString('ar'))}</td>
        <td style="${td}color:${t.type === 'debt' ? '#c0392b' : '#1b5e20'};font-weight:700;">
          ${t.type === 'debt' ? 'دين' : 'دفعة'}
        </td>
        <td style="${td}">${formatMinor(t.amount)} ${esc(currency)}</td>
        <td style="${td}max-width:220px;">${esc(shortNote(t.note))}</td>
      </tr>`)
    .join('');
}

function totalsHtml(o: StatementOptions): string {
  let debt = 0;
  let pay = 0;
  for (const t of o.transactions) {
    if (t.type === 'debt') debt += t.amount;
    else pay += t.amount;
  }
  const balance = debt - pay;
  const balanceWord = balance > 0 ? '(عليه)' : balance < 0 ? '(له)' : '(مسدد)';
  return `
    <table style="width:100%;font-size:15px;margin-top:18px;">
      <tr><td>إجمالي الديون:</td><td style="color:#c0392b;">${formatMinor(debt)} ${esc(o.currency)}</td></tr>
      <tr><td>إجمالي الدفعات:</td><td style="color:#1b5e20;">${formatMinor(pay)} ${esc(o.currency)}</td></tr>
      <tr><td><b>الرصيد:</b></td><td><b>${formatMinor(Math.abs(balance))} ${esc(o.currency)} ${balanceWord}</b></td></tr>
    </table>`;
}

function buildPageHtml(
  o: StatementOptions,
  txns: Transaction[],
  pageNo: number,
  totalPages: number,
  withTotals: boolean,
  issuedAt: string,
): string {
  const body = txns.length
    ? rowsHtml(txns, o.currency)
    : `<tr><td colspan="4" style="${td}">لا توجد حركات في هذه الفترة</td></tr>`;

  return `
  <div dir="rtl" style="font-family:'Cairo','Tahoma',sans-serif;width:${PAGE_W}px;height:${PAGE_H}px;padding:28px;color:#222;background:#fff;box-sizing:border-box;overflow:hidden;position:relative;">
    <h1 style="text-align:center;margin:0 0 4px;font-size:26px;">${esc(o.storeName || 'دفتر البقالة')}</h1>
    <h2 style="text-align:center;margin:0 0 20px;font-size:18px;color:#666;font-weight:500;">كشف حساب العميل</h2>
    <table style="width:100%;font-size:14px;margin-bottom:14px;">
      <tr><td>الاسم:</td><td><b>${esc(o.customer.name)}</b></td><td>الهاتف:</td><td>${esc(o.customer.phone)}</td></tr>
      <tr><td>الفترة:</td><td>${esc(o.periodLabel)}</td><td>تاريخ الإصدار:</td><td>${esc(issuedAt)}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#6b8e23;color:#fff;">
          <th style="${td}">التاريخ</th>
          <th style="${td}">النوع</th>
          <th style="${td}">المبلغ</th>
          <th style="${td}">ملاحظة</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
    ${withTotals ? totalsHtml(o) : ''}
    <div style="position:absolute;bottom:12px;left:0;right:0;text-align:center;font-size:11px;color:#999;">
      صفحة ${pageNo} من ${totalPages}
    </div>
  </div>`;
}

// Let the WebView paint/GC between page snapshots. Without this the export is
// one long synchronous block and Android shows an ANR-style freeze.
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function exportCustomerStatement(o: StatementOptions): Promise<void> {
  const pages = chunk(o.transactions, ROWS_PER_PAGE);
  if (pages.length === 0) pages.push([]);
  // The totals block needs room under the last table; if that page is nearly
  // full it would overflow the fixed-height page box, so give totals their own.
  const totalsSpill = pages[pages.length - 1].length > ROWS_LEAVING_ROOM_FOR_TOTALS;
  if (totalsSpill) pages.push([]);
  const totalPages = pages.length;
  const issuedAt = new Date().toLocaleString('ar');

  // Render each page off-screen so html2canvas can snapshot it.
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-10000px';
  host.style.top = '0';
  document.body.appendChild(host);

  try {
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    for (let i = 0; i < totalPages; i++) {
      const isLast = i === totalPages - 1;
      host.innerHTML = buildPageHtml(o, pages[i], i + 1, totalPages, isLast, issuedAt);
      const target = host.firstElementChild as HTMLElement;
      const canvas = await html2canvas(target, {
        scale: CANVAS_SCALE,
        backgroundColor: '#ffffff',
      });
      // JPEG, not PNG: a PNG of the full history ran to tens of MB of base64,
      // which is what the WhatsApp plugin then had to marshal across the bridge.
      const imgData = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      // Free the backing bitmap now rather than waiting on GC.
      canvas.width = 0;
      canvas.height = 0;

      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, 0, pageW, pageH);

      host.innerHTML = '';
      await yieldToUi();
    }

    const filename = `كشف-${o.customer.name}-${Date.now()}.pdf`.replace(/\s+/g, '_');

    if (Capacitor.getPlatform() === 'web') {
      pdf.save(filename);
      return;
    }

    const base64 = pdf.output('datauristring').split(',')[1];

    // Native: hand the PDF to WhatsApp with the file attached. WhatsApp opens on
    // its "send to" screen so the grocer taps the target customer — WhatsApp's
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
  } finally {
    document.body.removeChild(host);
  }
}
