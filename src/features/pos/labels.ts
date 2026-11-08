import JsBarcode from 'jsbarcode';
import type { PosProduct } from './products';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The barcode (EAN-13, as on shop products) for one code, as an SVG string, with
 *  the code written under the bars like a shop barcode. It scales with its
 *  box, keeping its proportions, so the same drawing prints at any label size. */
export function barcodeSvg(code: string): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(svg, code, {
    format: 'EAN13', margin: 0, width: 2, height: 90,
    displayValue: true, fontSize: 22, textMargin: 4, font: 'monospace',
  });
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  return svg.outerHTML;
}

/** A printable A4 sheet of labels — the browser shapes the Arabic. */
export async function labelsHtml(products: PosProduct[]): Promise<string> {
  const labels = products.map((p) =>
    `<div class="label">${barcodeSvg(p.code)}<b>${esc(p.name)}</b></div>`);
  // Cutting guide: ONE dashed line between neighbours (the cells share their
  // borders), and generous padding inside each cell, so there is blank paper on
  // all four sides of every barcode — the scissors never come near the bars, and
  // the scanner gets the empty margin a barcode needs on both of its ends.
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">
<title>رموز المنتجات</title>
<style>
  @page { size: A4; margin: 10mm }
  body { font-family: Tajawal, Arial, sans-serif; margin: 0 }
  .sheet { display: grid; grid-template-columns: repeat(3, 1fr);
           border-top: 1px dashed #666; border-left: 1px dashed #666 }
  .label { border-right: 1px dashed #666; border-bottom: 1px dashed #666;
           padding: 9mm 8mm; text-align: center; break-inside: avoid;
           display: flex; flex-direction: column; align-items: center; gap: 2mm }
  .label svg { width: 100%; height: auto }
  .label b { font-size: 13pt; line-height: 1.3 }
</style>
<div class="sheet">${labels.join('')}</div></html>`;
}

/** Open the labels in a new tab and print. Browser only for now: on the phone
 *  the sheet will go through the system print dialog as a PDF (next step). */
export async function printLabelsInBrowser(products: PosProduct[]): Promise<void> {
  const html = await labelsHtml(products);
  const w = window.open('', '_blank');
  if (!w) throw new Error('اسمح بالنوافذ المنبثقة لطباعة الملصقات');
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}
