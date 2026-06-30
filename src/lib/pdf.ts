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
// On native (Android) the PDF is written to the cache and handed to the system
// share sheet; on web it just downloads.

export interface StatementOptions {
  customer: Customer;
  transactions: Transaction[]; // already filtered to the chosen period
  storeName: string;
  currency: string;
  periodLabel: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function buildHtml(o: StatementOptions): string {
  let debt = 0;
  let pay = 0;
  for (const t of o.transactions) {
    if (t.type === 'debt') debt += t.amount;
    else pay += t.amount;
  }
  const balance = debt - pay;
  const td = 'padding:8px;border:1px solid #ddd;text-align:center;';

  const rows = o.transactions
    .map((t) => `
      <tr>
        <td style="${td}">${esc(new Date(t.occurred_at).toLocaleString('ar'))}</td>
        <td style="${td}color:${t.type === 'debt' ? '#c0392b' : '#1b5e20'};font-weight:700;">
          ${t.type === 'debt' ? 'دين' : 'دفعة'}
        </td>
        <td style="${td}">${formatMinor(t.amount)} ${esc(o.currency)}</td>
        <td style="${td}">${esc(t.note ?? '')}</td>
      </tr>`)
    .join('');

  const balanceWord = balance > 0 ? '(عليه)' : balance < 0 ? '(له)' : '(مسدد)';

  return `
  <div dir="rtl" style="font-family:'Cairo','Tahoma',sans-serif;width:760px;padding:28px;color:#222;background:#fff;box-sizing:border-box;">
    <h1 style="text-align:center;margin:0 0 4px;font-size:26px;">${esc(o.storeName || 'دفتر البقالة')}</h1>
    <h2 style="text-align:center;margin:0 0 20px;font-size:18px;color:#666;font-weight:500;">كشف حساب العميل</h2>
    <table style="width:100%;font-size:14px;margin-bottom:14px;">
      <tr><td>الاسم:</td><td><b>${esc(o.customer.name)}</b></td><td>الهاتف:</td><td>${esc(o.customer.phone)}</td></tr>
      <tr><td>الفترة:</td><td>${esc(o.periodLabel)}</td><td>تاريخ الإصدار:</td><td>${esc(new Date().toLocaleString('ar'))}</td></tr>
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
      <tbody>${rows || `<tr><td colspan="4" style="${td}">لا توجد حركات في هذه الفترة</td></tr>`}</tbody>
    </table>
    <table style="width:100%;font-size:15px;margin-top:18px;">
      <tr><td>إجمالي الديون:</td><td style="color:#c0392b;">${formatMinor(debt)} ${esc(o.currency)}</td></tr>
      <tr><td>إجمالي الدفعات:</td><td style="color:#1b5e20;">${formatMinor(pay)} ${esc(o.currency)}</td></tr>
      <tr><td><b>الرصيد:</b></td><td><b>${formatMinor(Math.abs(balance))} ${esc(o.currency)} ${balanceWord}</b></td></tr>
    </table>
  </div>`;
}

export async function exportCustomerStatement(o: StatementOptions): Promise<void> {
  // Render the report off-screen so html2canvas can snapshot it.
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-10000px';
  host.style.top = '0';
  host.innerHTML = buildHtml(o);
  document.body.appendChild(host);

  try {
    const target = host.firstElementChild as HTMLElement;
    const canvas = await html2canvas(target, { scale: 2, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/png');

    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;

    // Slice a tall report across A4 pages by shifting the same image up.
    let heightLeft = imgH;
    let position = 0;
    pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH);
    heightLeft -= pageH;
    while (heightLeft > 0) {
      position -= pageH;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH);
      heightLeft -= pageH;
    }

    const filename = `كشف-${o.customer.name}-${Date.now()}.pdf`.replace(/\s+/g, '_');

    if (Capacitor.getPlatform() === 'web') {
      pdf.save(filename);
      return;
    }

    // Native: write to cache, then share.
    const base64 = pdf.output('datauristring').split(',')[1];
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
