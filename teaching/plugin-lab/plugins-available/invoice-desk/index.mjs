/**
 * PLUGIN · Invoice Desk — one screen, zero dependencies, fully offline.
 * PLUGIN · Fakturaskrivebord — én skjerm, null avhengigheter, helt offline.
 *
 * EN: A price list per currency → build an invoice by tapping + / − → REVIEW it
 *     (the total can be checked before anything is written) → record it with the
 *     next invoice number → print it or share it as a PDF. History keeps every
 *     invoice. It asks the HOST for storage, printing and sharing, and says so
 *     politely when one is missing.
 * NO: En prisliste per valuta → bygg en faktura med + / − → GJENNOMGÅ den
 *     (summen kan kontrolleres før noe skrives) → registrer den med neste
 *     fakturanummer → skriv den ut eller del den som PDF. Historikken beholder
 *     hver faktura. Den ber VERTEN om lager, utskrift og deling.
 *
 * Rules taken from the Daftar invoice, kept here on purpose / Regler fra Daftar-fakturaen:
 *   · ONE currency per invoice (a total must never mix riyals and dollars).
 *   · An invoice number is used up only when the invoice is RECORDED, so an
 *     abandoned draft leaves no gap in the numbered book.
 *   · The next number = the higher of the counter and the highest in history.
 *   · A recorded invoice is never edited — delete it from history if it was wrong.
 */

// ── 0 · Defaults — change anything here / Standardverdier ────────────────────
const DEFAULTS = {
  lang: 'en',               // 'en' | 'ar' | 'no'
  title: 'Invoice Desk',
  shop: '',                 // printed at the top of every invoice
  currency: 'YER',          // 'YER' | 'SAR' | 'USD'
  accent: '#1b5e20',
  footer: '',               // a line at the bottom, e.g. «Thank you»
};

// ── 1 · Money and numbers / Penger og tall ───────────────────────────────────
// Prices are whole numbers of cents, never floats. Arabic-Indic digits are accepted.
const toLatin = s => String(s)
  .replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x660)
  .replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x6f0)
  .replace(/[٫,]/g, '.');
export function toMinor(text) {
  const clean = toLatin(text).replace(/[^\d.]/g, '');
  const n = Number(clean);
  return /\d/.test(clean) && Number.isFinite(n) ? Math.round(n * 100) : null;
}
/** Decimals shown per currency: the Yemeni riyal is normally written without fractions. */
export const CURRENCIES = { YER: 0, SAR: 2, USD: 2 };
export function formatMoney(minor, cur) {
  const d = CURRENCIES[cur] ?? 2;
  return `${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })} ${cur}`;
}
/** Whole-number quantity from typed text (Arabic digits fine); null if not a positive integer. */
export const toQty = text => { const n = Number(toLatin(text).replace(/[^\d]/g, '')); return Number.isInteger(n) && n > 0 ? n : null; };
export const invoiceTotal = lines => lines.reduce((sum, l) => sum + l.price * l.qty, 0);
/** The next invoice number: the higher of the counter and the highest already in history. */
export function nextInvoiceNumber(counter, history) {
  return Math.max(Number(counter) || 0, ...history.map(i => Number(i.no) || 0)) + 1;
}
const pad = n => String(n).padStart(2, '0');
/** «2026-11-09 18:47» — fixed, Latin digits, local time. */
export function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ── 2 · Words, in three languages / Ord, på tre språk ────────────────────────
const WORDS = {
  en: {
    invoice: 'Invoice', items: 'Price list', history: 'History', settings: 'Settings', name: 'Name', price: 'Price',
    add: 'Add item', save: 'Save', cancel: 'Cancel', edit: 'Edit', del: 'Delete', sure: 'Sure?',
    customer: 'Customer', search: 'Search', total: 'Total', noItems: 'Add items to the price list first.',
    emptyInv: 'Tap + to add items.', review: 'Review', back: 'Back', confirm: 'Record invoice', newInv: 'New invoice',
    invNo: 'Invoice', date: 'Date', itemCol: 'Item', priceCol: 'Price', qtyCol: 'Qty', sumCol: 'Total',
    print: 'Print', share: 'Share PDF', noPrint: 'Printing is not available here.', noShare: 'Sharing is not available here.',
    makingPdf: 'Making PDF…', nameReq: 'Enter a name.', priceReq: 'Enter a valid price.', added: 'Added', saved: 'Saved',
    noHistory: 'No invoices yet.', lang: 'Language', titleL: 'Screen title', shop: 'Shop name on invoice',
    currency: 'Default currency', accent: 'Accent colour', footer: 'Note at the bottom', plus: 'More', minus: 'Less',
    noCustomer: 'Walk-in customer',
  },
  ar: {
    invoice: 'فاتورة', items: 'قائمة الأسعار', history: 'السجل', settings: 'الإعدادات', name: 'الاسم', price: 'السعر',
    add: 'إضافة صنف', save: 'حفظ', cancel: 'إلغاء', edit: 'تعديل', del: 'حذف', sure: 'متأكد؟',
    customer: 'الزبون', search: 'بحث', total: 'الإجمالي', noItems: 'أضف أصنافاً إلى قائمة الأسعار أولاً.',
    emptyInv: 'اضغط + لإضافة أصناف.', review: 'مراجعة', back: 'رجوع', confirm: 'تسجيل الفاتورة', newInv: 'فاتورة جديدة',
    invNo: 'فاتورة رقم', date: 'التاريخ', itemCol: 'الصنف', priceCol: 'السعر', qtyCol: 'العدد', sumCol: 'الإجمالي',
    print: 'طباعة', share: 'مشاركة PDF', noPrint: 'الطباعة غير متاحة هنا.', noShare: 'المشاركة غير متاحة هنا.',
    makingPdf: 'جارٍ إنشاء PDF…', nameReq: 'أدخل الاسم.', priceReq: 'أدخل سعراً صحيحاً.', added: 'تمت الإضافة', saved: 'تم الحفظ',
    noHistory: 'لا توجد فواتير بعد.', lang: 'اللغة', titleL: 'عنوان الشاشة', shop: 'اسم المتجر على الفاتورة',
    currency: 'العملة الافتراضية', accent: 'لون التمييز', footer: 'ملاحظة في الأسفل', plus: 'زيادة', minus: 'إنقاص',
    noCustomer: 'زبون نقدي',
  },
  no: {
    invoice: 'Faktura', items: 'Prisliste', history: 'Historikk', settings: 'Innstillinger', name: 'Navn', price: 'Pris',
    add: 'Legg til vare', save: 'Lagre', cancel: 'Avbryt', edit: 'Rediger', del: 'Slett', sure: 'Sikker?',
    customer: 'Kunde', search: 'Søk', total: 'Sum', noItems: 'Legg først varer i prislisten.',
    emptyInv: 'Trykk + for å legge til varer.', review: 'Gjennomgå', back: 'Tilbake', confirm: 'Registrer faktura', newInv: 'Ny faktura',
    invNo: 'Faktura nr.', date: 'Dato', itemCol: 'Vare', priceCol: 'Pris', qtyCol: 'Ant.', sumCol: 'Sum',
    print: 'Skriv ut', share: 'Del PDF', noPrint: 'Utskrift er ikke tilgjengelig her.', noShare: 'Deling er ikke tilgjengelig her.',
    makingPdf: 'Lager PDF…', nameReq: 'Skriv et navn.', priceReq: 'Skriv en gyldig pris.', added: 'Lagt til', saved: 'Lagret',
    noHistory: 'Ingen fakturaer ennå.', lang: 'Språk', titleL: 'Skjermtittel', shop: 'Butikknavn på fakturaen',
    currency: 'Standardvaluta', accent: 'Aksentfarge', footer: 'Merknad nederst', plus: 'Flere', minus: 'Færre',
    noCustomer: 'Kontantkunde',
  },
};

// ── 3 · Labels as a PDF — for sharing / Faktura som PDF — for deling ──────────
// No library: a PDF page can simply hold one JPEG picture, drawn on a canvas so the
// browser shapes the Arabic and uses the Tajawal Bold font.
const A4 = [595.28, 841.89];
const bytesToBase64 = u8 => { let bin = ''; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(bin); };
const base64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

/** pages: [{ jpeg: Uint8Array, w, h }] → the bytes of a PDF with one page per picture. */
export function buildPdf(pages) {
  const enc = new TextEncoder(), parts = [], offsets = [];
  let len = 0;
  const push = x => { const u = typeof x === 'string' ? enc.encode(x) : x; parts.push(u); len += u.length; };
  const obj = (n, head, stream) => {
    offsets[n] = len;
    push(`${n} 0 obj\n${head}\n`);
    if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
    push('endobj\n');
  };
  push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
  pages.forEach((pg, i) => {
    const page = 3 + i * 3, content = page + 1, image = page + 2;
    obj(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4[0]} ${A4[1]}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`);
    const draw = enc.encode(`q ${A4[0]} 0 0 ${A4[1]} 0 0 cm /Im0 Do Q`);
    obj(content, `<< /Length ${draw.length} >>`, draw);
    obj(image, `<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>`, pg.jpeg);
  });
  const xref = len, total = 3 + pages.length * 3;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len); let at = 0;
  for (const u of parts) { out.set(u, at); at += u.length; }
  return out;
}

/** The invoice drawn on A4-shaped canvases (150 dpi), as JPEG pages. More rows → more pages. */
export async function renderInvoicePages(inv, s, words) {
  const W = 1240, H = 1754, M = 90, rtl = s.lang === 'ar', ROW = 58, HEAD = 62;
  const COLS = [0.44, 0.2, 0.12, 0.24];                          // item · price · qty · total
  const inner = W - 2 * M;
  try { await document.fonts?.load("700 20px 'Tajawal'"); } catch { /* falls back to a system face */ }
  const shop = s.shop || s.title;
  const rows = inv.lines;
  const firstTop = M + 250, otherTop = M + 40;                   // where the table starts on page 1 / later pages
  const footerH = 160 + (s.footer ? 70 : 0);
  const pages = [];
  let at = 0;
  do {
    const first = pages.length === 0;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#000'; g.direction = rtl ? 'rtl' : 'ltr'; g.textBaseline = 'middle';
    const edge = rtl ? W - M : M, side = rtl ? 'right' : 'left';
    if (first) {
      g.textAlign = side;
      g.font = "700 60px 'Tajawal', sans-serif"; g.fillText(shop, edge, M + 40);
      g.font = "700 38px 'Tajawal', sans-serif";
      g.fillText(`${words.invNo} ${inv.no}`, edge, M + 110);
      g.fillText(`${words.date}: ${fmtDate(inv.date)}`, edge, M + 160);
      g.fillText(`${words.customer}: ${inv.customer || words.noCustomer}`, edge, M + 210);
    }
    const top = first ? firstTop : otherTop;
    const room = Math.floor((H - M - top - HEAD - footerH) / ROW);
    const fits = Math.max(1, room);
    const chunk = rows.slice(at, at + fits);
    // column x-ranges, mirrored for right-to-left
    let x = rtl ? W - M : M;
    const cols = COLS.map(f => { const w = inner * f; const c = rtl ? { x: x - w, w } : { x, w }; x += rtl ? -w : w; return c; });
    const heads = [words.itemCol, words.priceCol, words.qtyCol, words.sumCol];
    g.fillStyle = '#e8f5e9'; g.fillRect(M, top, inner, HEAD);
    g.fillStyle = '#000'; g.font = "700 32px 'Tajawal', sans-serif";
    heads.forEach((txt, i) => { g.textAlign = i === 0 ? side : 'center'; g.fillText(txt, i === 0 ? (rtl ? cols[i].x + cols[i].w - 12 : cols[i].x + 12) : cols[i].x + cols[i].w / 2, top + HEAD / 2); });
    g.strokeStyle = '#999'; g.lineWidth = 2;
    chunk.forEach((l, r) => {
      const y = top + HEAD + r * ROW;
      g.font = "700 32px 'Tajawal', sans-serif";
      let name = l.name; while (name.length > 1 && g.measureText(name).width > cols[0].w - 24) name = name.slice(0, -1);
      if (name !== l.name) name += '…';
      g.textAlign = side; g.fillText(name, rtl ? cols[0].x + cols[0].w - 12 : cols[0].x + 12, y + ROW / 2);
      g.textAlign = 'center';
      [formatMoney(l.price, inv.cur), String(l.qty), formatMoney(l.price * l.qty, inv.cur)].forEach((txt, i) => g.fillText(txt, cols[i + 1].x + cols[i + 1].w / 2, y + ROW / 2));
      g.beginPath(); g.moveTo(M, y + ROW); g.lineTo(W - M, y + ROW); g.stroke();
    });
    at += chunk.length;
    if (at >= rows.length) {                                      // last page: total + footer
      const y = top + HEAD + chunk.length * ROW + 50;
      g.textAlign = side; g.font = "700 48px 'Tajawal', sans-serif";
      g.fillStyle = s.accent; g.fillText(`${words.total}: ${formatMoney(inv.total, inv.cur)}`, edge, y);
      if (s.footer) { g.fillStyle = '#000'; g.font = "700 34px 'Tajawal', sans-serif"; g.fillText(s.footer, edge, y + 80); }
    }
    pages.push({ jpeg: base64ToBytes(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]), w: W, h: H });
  } while (at < rows.length);
  return pages;
}

// ── 4 · Icons (inline SVG, no files) / Ikoner ────────────────────────────────
const ICONS = {
  invoice: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6"/>',
  items: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  check: '<path d="M5 12.5l5 5L19 7"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13 7l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
};
function icon(name, size = 26) {
  const span = document.createElement('span');
  span.className = 'ic';
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return span;
}
/** A tiny DOM helper. Children may be nested arrays; null/false are skipped. */
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = true;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(kid));
  return e;
}
/** An icon-only button. The label is for screen readers and the long-press tooltip. */
const iconBtn = (name, label, cls, act, onclick, size, extra = {}) =>
  h('button', { class: `ib ${cls}`, 'aria-label': label, title: label, 'data-act': act, onclick, ...extra }, icon(name, size));

const CSS = `
.bd{font-family:'Tajawal',system-ui,sans-serif;font-weight:700;color:#1b1b1b;background:#f4f6f4;min-height:100%;padding:12px 12px 24px;box-sizing:border-box}
.bd *{font-family:inherit;font-weight:700;box-sizing:border-box}
.bd h1{margin:4px 0 12px;font-size:32px;color:var(--bd-accent)}
.bd .tabs{display:flex;gap:6px;margin-bottom:12px}
.bd .tabs button{flex:1;height:54px;display:flex;align-items:center;justify-content:center;border:0;border-radius:12px;background:#e3e8e3;color:#444}
.bd .tabs button.on{background:var(--bd-accent);color:#fff}
.bd .card{background:#fff;border-radius:12px;padding:12px;margin-bottom:10px;box-shadow:0 1px 3px #0002}
.bd input[type=text],.bd select{width:100%;padding:10px;margin:4px 0 8px;border:1px solid #bbb;border-radius:8px;font-size:19px;
  /* Old Android WebViews (Note 9) paint a FOCUSED non-opaque input as a solid box that hides the text.
     Fix: opaque background + explicit colour + text-fill-colour, no native look, no effects. */
  background:#ffffff;color:#111111;-webkit-text-fill-color:#111111;caret-color:#111111;opacity:1;filter:none;transform:none;
  -webkit-appearance:none;appearance:none;color-scheme:light;outline:none}
.bd input[type=text]:focus,.bd select:focus{background:#ffffff;color:#111111;-webkit-text-fill-color:#111111;border-color:var(--bd-accent)}
.bd input::placeholder{color:#888;-webkit-text-fill-color:#888;opacity:1}
.bd label{display:block;font-size:16px;color:#555}
.bd .row{display:flex;gap:8px;align-items:center}
.bd .grow{flex:1;min-width:0}
.bd .ib{width:50px;height:50px;border:0;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;padding:0;flex:none}
.bd .ib.pri{background:var(--bd-accent);color:#fff}.bd .ib.sec{background:#e3e8e3;color:#222}
.bd .ib.dng{background:#fde8e8;color:#c62828}.bd .ib.dng.solid{background:#c62828;color:#fff}
.bd .ib.grow{width:auto}.bd .ib[disabled]{opacity:.4}
.bd select[data-f=cur]{width:auto;min-width:0;display:block;padding:8px 32px 8px 14px;margin:4px 0 10px;font-size:18px;border:0;border-radius:8px;
  background:var(--bd-accent) url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'><path d='M1 1l5 5 5-5' fill='none' stroke='white' stroke-width='2'/></svg>") no-repeat right 10px center;
  color:#fff;-webkit-text-fill-color:#fff}
.bd[dir=rtl] select[data-f=cur]{padding:8px 14px 8px 32px;background-position:left 10px center}
.bd select[data-f=cur] option{color:#111;background:#fff;-webkit-text-fill-color:#111}
.bd .line{display:flex;align-items:center;gap:10px}
.bd .line .info{flex:1;min-width:0}
.bd .line .info b{display:block;font-size:20px;overflow-wrap:anywhere}
.bd .line .info span{color:var(--bd-accent);font-size:18px}
.bd .qty{display:flex;align-items:center;gap:8px}
.bd .qty b{min-width:34px;text-align:center;font-size:24px}
.bd .muted{color:#777;font-size:16px}
.bd .totalbar{position:sticky;bottom:0;background:#fff;box-shadow:0 -2px 10px #0003;border-radius:14px;padding:10px 12px;display:flex;align-items:center;gap:10px;margin-top:10px}
.bd .totalbar b{font-size:26px;color:var(--bd-accent)}
.bd .doc h2{margin:0 0 6px;font-size:26px;color:var(--bd-accent)}
.bd .doc .meta{font-size:17px;color:#333;margin-bottom:2px}
.bd .doc table{width:100%;border-collapse:collapse;margin:10px 0}
.bd .doc th{background:#e8f5e9;font-size:15px;padding:8px 4px}
.bd .doc td{padding:9px 4px;border-bottom:1px solid #eee;font-size:17px;text-align:center}
.bd .doc td:first-child,.bd .doc th:first-child{text-align:start}
.bd .doc .sum{font-size:26px;color:var(--bd-accent);margin-top:8px}
.bd .acts{display:flex;gap:14px;justify-content:center;margin:12px 0;flex-wrap:wrap}
.bd .toast{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);background:#222;color:#fff;padding:10px 16px;border-radius:20px;font-size:15px;max-width:90%;z-index:50}
.bd .toast.bad{background:#c62828}
`;

// ── 5 · The screen / Skjermen ────────────────────────────────────────────────
export function mount(el, ctx) {
  const store = ctx.storage;
  const userSettings = store.get('settings', {});
  const S = () => ({ ...DEFAULTS, ...(ctx.options || {}), ...userSettings });
  const t = k => WORDS[S().lang]?.[k] ?? WORDS.en[k];
  let items = store.get('items', []);            // [{ id, name, price(cents), currency }]
  let history = store.get('history', []);        // [{ no, date, customer, cur, lines:[{name,price,qty}], total }]
  let seq = store.get('seq', 0);                 // last number handed out
  let tab = 'invoice', mode = 'edit', shown = null, alive = true, confirm = null, editing = null;
  let draft = { cur: null, customer: '', qty: {}, search: '' };
  let itemDraft = { name: '', price: '', cur: null };
  const cur = () => draft.cur || S().currency;
  const persist = () => { store.set('items', items); store.set('history', history); store.set('seq', seq); };

  const root = h('div', { class: 'bd' });
  const toast = h('div', { class: 'toast' }); toast.hidden = true;
  let toastTimer = 0;
  function flash(msg, bad = false) {
    toast.textContent = msg; toast.className = 'toast' + (bad ? ' bad' : ''); toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
  }

  // ── invoice logic ──
  const currentLines = () => items.filter(i => i.currency === cur() && draft.qty[i.id] > 0).map(i => ({ name: i.name, price: i.price, qty: draft.qty[i.id], id: i.id }));
  const setQty = (id, n) => { if (n > 0) draft.qty[id] = n; else delete draft.qty[id]; };
  function recordInvoice() {
    const lines = currentLines();
    if (!lines.length) return flash(t('emptyInv'), true);
    seq = nextInvoiceNumber(seq, history);                       // the number is used up only NOW
    const inv = { no: seq, date: new Date().toISOString(), customer: draft.customer.trim(), cur: cur(),
      lines: lines.map(({ name, price, qty }) => ({ name, price, qty })), total: invoiceTotal(lines) };
    history.unshift(inv);
    draft = { cur: draft.cur, customer: '', qty: {}, search: '' };
    persist(); shown = inv; mode = 'show'; render();
  }

  // ── output: print / share ──
  async function invoiceHtml(inv) {
    const s = S(), w = WORDS[s.lang] ?? WORDS.en;
    const font = ctx.fontCss ? await ctx.fontCss().catch(() => '') : '';
    const rows = inv.lines.map(l => `<tr><td>${esc(l.name)}</td><td>${esc(formatMoney(l.price, inv.cur))}</td><td>${l.qty}</td><td>${esc(formatMoney(l.price * l.qty, inv.cur))}</td></tr>`).join('');
    return `<!doctype html><html lang="${s.lang}" dir="${s.lang === 'ar' ? 'rtl' : 'ltr'}"><meta charset="utf-8"><title>${esc(s.shop || s.title)}</title>
<style>${font}
@page{size:A4;margin:14mm}
body{font-family:'Tajawal',Arial,sans-serif;font-weight:700;margin:0;color:#000}
h1{font-size:26pt;margin:0 0 4mm}.m{font-size:13pt;margin:1mm 0}
table{width:100%;border-collapse:collapse;margin:6mm 0}
th{background:#e8f5e9;font-size:12pt;padding:2mm}td{padding:2.4mm;border-bottom:1px solid #999;font-size:13pt;text-align:center}
td:first-child,th:first-child{text-align:start}
.t{font-size:18pt;color:${esc(s.accent)}}.f{margin-top:8mm;font-size:12pt}
</style><h1>${esc(s.shop || s.title)}</h1>
<div class="m">${esc(w.invNo)} ${inv.no}</div><div class="m">${esc(w.date)}: ${fmtDate(inv.date)}</div><div class="m">${esc(w.customer)}: ${esc(inv.customer || w.noCustomer)}</div>
<table><tr><th>${esc(w.itemCol)}</th><th>${esc(w.priceCol)}</th><th>${esc(w.qtyCol)}</th><th>${esc(w.sumCol)}</th></tr>${rows}</table>
<div class="t">${esc(w.total)}: ${esc(formatMoney(inv.total, inv.cur))}</div>${s.footer ? `<div class="f">${esc(s.footer)}</div>` : ''}</html>`;
  }
  async function printInvoice(inv) {
    if (!ctx.print) return flash(t('noPrint'), true);
    try { await ctx.print(await invoiceHtml(inv), `${t('invNo')} ${inv.no}`); } catch (e) { flash(e.message || t('noPrint'), true); }
  }
  async function shareInvoice(inv) {
    if (!ctx.share) return flash(t('noShare'), true);
    try {
      flash(t('makingPdf'));
      const pdf = buildPdf(await renderInvoicePages(inv, S(), WORDS[S().lang] ?? WORDS.en));
      await ctx.share(`invoice-${inv.no}.pdf`, bytesToBase64(pdf), 'application/pdf');
    } catch (e) { flash(e.message || t('noShare'), true); }
  }

  // ── views ──
  const curSelect = (value, onchange) => h('select', { 'data-f': 'cur', 'aria-label': t('currency'), onchange: e => onchange(e.target.value) },
    Object.keys(CURRENCIES).map(c => h('option', { value: c, selected: c === value }, c)));

  function qtyControls(i, rerender) {
    const n = draft.qty[i.id] || 0;
    return h('div', { class: 'qty' },
      iconBtn('minus', t('minus'), 'sec', 'dec', () => { setQty(i.id, n - 1); rerender(); }, 24),
      h('b', { 'data-qty': i.id }, String(n)),
      iconBtn('plus', t('plus'), 'pri', 'inc', () => { setQty(i.id, n + 1); rerender(); }, 24));
  }

  function invoiceView() {
    const c = cur();
    const pool = items.filter(i => i.currency === c);
    const q = draft.search.trim().toLowerCase();
    const list = pool.filter(i => !q || i.name.toLowerCase().includes(q));
    const lines = currentLines(), total = invoiceTotal(lines);
    return [
      h('div', { class: 'card' },
        curSelect(c, v => { draft.cur = v; draft.qty = {}; render(); }),   // one currency per invoice: switching clears the basket
        h('label', {}, t('customer')),
        h('input', { type: 'text', 'data-f': 'customer', value: draft.customer, oninput: e => { draft.customer = e.target.value; } }),
        h('label', {}, t('search')),
        h('input', { type: 'text', 'data-f': 'search', value: draft.search, oninput: e => { draft.search = e.target.value; renderList(); } })),
      items.length === 0 ? h('p', { class: 'muted' }, t('noItems')) : null,
      h('div', { 'data-list': '' }, listRows(list)),
      h('div', { class: 'totalbar' },
        h('span', { class: 'grow muted' }, t('total')),
        h('b', { 'data-total': '' }, formatMoney(total, c)),
        iconBtn('check', t('review'), 'pri', 'review', () => { if (!lines.length) return flash(t('emptyInv'), true); mode = 'review'; render(); }, 28, lines.length ? {} : { disabled: true })),
    ];
  }
  function listRows(list) {
    return list.map(i => h('div', { class: 'card line', 'data-item': i.id },
      h('div', { class: 'info' }, h('b', {}, i.name), h('span', {}, formatMoney(i.price, i.currency))),
      qtyControls(i, render)));
  }
  // typing in the search box must not rebuild the box itself (it would lose focus)
  function renderList() {
    const box = root.querySelector('[data-list]'); if (!box) return;
    const q = draft.search.trim().toLowerCase();
    box.replaceChildren(...listRows(items.filter(i => i.currency === cur() && (!q || i.name.toLowerCase().includes(q)))));
  }

  /** The invoice as a document: used for the review (editable quantities) and for a recorded one. */
  function docCard(inv, editable) {
    const s = S();
    const no = inv.no ?? nextInvoiceNumber(seq, history);
    return h('div', { class: 'card doc' },
      h('h2', {}, s.shop || s.title),
      h('div', { class: 'meta', 'data-doc-no': String(no) }, `${t('invNo')} ${no}`),
      h('div', { class: 'meta' }, `${t('date')}: ${fmtDate(inv.date)}`),
      h('div', { class: 'meta' }, `${t('customer')}: ${inv.customer || t('noCustomer')}`),
      h('table', {},
        h('tr', {}, [t('itemCol'), t('priceCol'), t('qtyCol'), t('sumCol')].map(x => h('th', {}, x))),
        inv.lines.map(l => h('tr', { 'data-line': l.name },
          h('td', {}, l.name), h('td', {}, formatMoney(l.price, inv.cur)),
          h('td', {}, editable ? qtyControls({ id: l.id }, render) : String(l.qty)),
          h('td', {}, formatMoney(l.price * l.qty, inv.cur))))),
      h('div', { class: 'sum', 'data-doc-total': '' }, `${t('total')}: ${formatMoney(inv.total, inv.cur)}`),
      s.footer ? h('div', { class: 'muted', style: 'margin-top:8px' }, s.footer) : null);
  }
  function reviewView() {
    const lines = currentLines();
    const inv = { date: new Date().toISOString(), customer: draft.customer.trim(), cur: cur(), lines, total: invoiceTotal(lines) };
    return [docCard(inv, true),
      h('div', { class: 'acts' },
        iconBtn('back', t('back'), 'sec', 'back', () => { mode = 'edit'; render(); }, 28),
        iconBtn('check', t('confirm'), 'pri', 'confirm', recordInvoice, 30))];
  }
  function showView() {
    const inv = shown;
    return [docCard(inv, false),
      h('div', { class: 'acts' },
        iconBtn('back', t('back'), 'sec', 'back', () => { mode = 'edit'; shown = null; render(); }, 28),
        iconBtn('print', t('print'), 'pri', 'print', () => printInvoice(inv), 28),
        iconBtn('share', t('share'), 'pri', 'share', () => shareInvoice(inv), 28),
        iconBtn('plus', t('newInv'), 'pri', 'new', () => { mode = 'edit'; shown = null; tab = 'invoice'; render(); }, 28),
        iconBtn(confirm === `#inv${inv.no}` ? 'check' : 'trash', confirm === `#inv${inv.no}` ? t('sure') : t('del'), confirm === `#inv${inv.no}` ? 'dng solid' : 'dng', 'del-inv', () => {
          if (confirm !== `#inv${inv.no}`) { confirm = `#inv${inv.no}`; render(); return; }
          history = history.filter(x => x.no !== inv.no); confirm = null; shown = null; mode = 'edit'; persist(); render();
        }, 28))];
  }

  function itemsView() {
    const c = itemDraft.cur || S().currency;
    const submit = () => {
      const c = itemDraft.cur || S().currency;                       // read NOW: the drop-down may have changed since the last render
      const name = itemDraft.name.trim(), price = toMinor(itemDraft.price.trim());
      if (!name) return flash(t('nameReq'), true);
      if (price == null) return flash(t('priceReq'), true);
      if (editing) { const i = items.find(x => x.id === editing); if (i) { i.name = name; i.price = price; i.currency = c; } editing = null; flash(t('saved')); }
      else { items.unshift({ id: uid(), name, price, currency: c }); flash(t('added')); }
      itemDraft = { name: '', price: '', cur: null }; persist(); render();
    };
    return [
      h('div', { class: 'card' },
        h('label', {}, t('name')),
        h('input', { type: 'text', 'data-f': 'name', value: itemDraft.name, oninput: e => { itemDraft.name = e.target.value; } }),
        h('label', {}, t('price')),
        h('input', { type: 'text', inputmode: 'decimal', 'data-f': 'price', value: itemDraft.price, oninput: e => { itemDraft.price = e.target.value; } }),
        curSelect(c, v => { itemDraft.cur = v; }),
        h('div', { class: 'row' },
          iconBtn(editing ? 'check' : 'plus', editing ? t('save') : t('add'), 'pri grow', 'add', submit, 30),
          editing && iconBtn('x', t('cancel'), 'sec', 'cancel', () => { editing = null; itemDraft = { name: '', price: '', cur: null }; render(); }))),
      items.map(i => h('div', { class: 'card line', 'data-item': i.id },
        h('div', { class: 'info' }, h('b', {}, i.name), h('span', {}, formatMoney(i.price, i.currency))),
        iconBtn('edit', t('edit'), 'sec', 'edit', () => { editing = i.id; itemDraft = { name: i.name, price: (i.price / 100).toFixed(2), cur: i.currency }; render(); }),
        iconBtn(confirm === i.id ? 'check' : 'trash', confirm === i.id ? t('sure') : t('del'), confirm === i.id ? 'dng solid' : 'dng', 'del', () => {
          if (confirm !== i.id) { confirm = i.id; render(); return; }
          items = items.filter(x => x.id !== i.id); delete draft.qty[i.id]; confirm = null; persist(); render();
        }))),
    ];
  }

  function historyView() {
    if (!history.length) return h('p', { class: 'muted' }, t('noHistory'));
    return history.map(inv => h('div', { class: 'card line', 'data-inv': String(inv.no), style: 'cursor:pointer',
      onclick: () => { shown = inv; mode = 'show'; render(); } },
      h('div', { class: 'info' },
        h('b', {}, `${t('invNo')} ${inv.no} · ${inv.customer || t('noCustomer')}`),
        h('span', {}, `${formatMoney(inv.total, inv.cur)}  ·  ${fmtDate(inv.date)}`))));
  }

  function settingsView() {
    const s = S();
    const set = (k, v) => { userSettings[k] = v; store.set('settings', userSettings); render(); };
    const field = (label, input) => h('div', {}, h('label', {}, label), input);
    const text = key => h('input', { type: 'text', 'data-s': key, value: s[key], onchange: e => set(key, e.target.value) });
    const sel = (key, opts) => h('select', { 'data-s': key, onchange: e => set(key, e.target.value) },
      opts.map(([v, l]) => h('option', { value: v, selected: String(s[key]) === String(v) }, l)));
    return h('div', { class: 'card' },
      field(t('lang'), sel('lang', [['en', 'English'], ['ar', 'العربية'], ['no', 'Norsk']])),
      field(t('titleL'), text('title')),
      field(t('shop'), text('shop')),
      field(t('currency'), sel('currency', Object.keys(CURRENCIES).map(c => [c, c]))),
      field(t('accent'), h('input', { type: 'color', 'data-s': 'accent', value: s.accent, style: 'width:100%;height:42px;margin:4px 0 8px', onchange: e => set('accent', e.target.value) })),
      field(t('footer'), text('footer')));
  }

  function render() {
    if (!alive) return;
    const s = S();
    root.style.setProperty('--bd-accent', s.accent);
    root.dir = s.lang === 'ar' ? 'rtl' : 'ltr';
    const tabs = [['invoice', t('invoice')], ['items', t('items')], ['history', t('history')], ['settings', t('settings')]];
    if (mode === 'review' && !currentLines().length) mode = 'edit';   // every line removed in the review → back to picking
    const documentMode = mode === 'review' || mode === 'show';
    const view = documentMode ? (mode === 'review' ? reviewView() : showView())
      : tab === 'invoice' ? invoiceView() : tab === 'items' ? itemsView() : tab === 'history' ? historyView() : settingsView();
    root.replaceChildren(
      h('h1', {}, s.title),
      !documentMode && h('div', { class: 'tabs' }, tabs.map(([id, label]) =>
        h('button', { class: id === tab ? 'on' : '', 'data-tab': id, 'aria-label': label, title: label,
          onclick: () => { tab = id; confirm = null; render(); } }, icon(id, 30)))),
      ...[view].flat(Infinity).filter(Boolean), toast);
  }

  el.replaceChildren(h('style', {}, CSS), root);
  render();
  return () => { alive = false; clearTimeout(toastTimer); };
}

// ── 6 · The only door into the host / Den eneste døren inn til verten ─────────
export function register(host) {
  host.screen?.({ id: 'desk', title: DEFAULTS.title, icon: '🧾', mount });
}
