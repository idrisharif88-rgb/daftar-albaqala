/**
 * PLUGIN · Barcode Desk — one screen, zero dependencies, fully offline.
 * PLUGIN · Strekkode-skrivebord — én skjerm, null avhengigheter, helt offline.
 *
 * EN: Add products with a price → each gets its own EAN-13 barcode → print the
 *     labels → scan them from paper → see a count per product, unknown codes
 *     marked «not known», a happy beep for a known code and a sad one for an
 *     unknown. It knows nothing about any particular app: it asks the HOST for
 *     storage, a scanner and a printer, and works without the last two.
 * NO: Legg til varer med pris → hver får sin egen EAN-13-strekkode → skriv ut
 *     etikettene → skann dem fra papir → se antall per vare, ukjente koder
 *     merket «ikke kjent», en glad pipelyd for kjent kode og en trist for
 *     ukjent. Den kjenner ingen bestemt app: den ber VERTEN om lager, skanner
 *     og skriver, og fungerer uten de to siste.
 *
 * Customise it three ways / Tilpass på tre måter:
 *   1. the Settings tab (the user)            2. ctx.options (the app embedding it)
 *   3. edit DEFAULTS below (the developer)
 */

// ── 0 · Defaults — change anything here / Standardverdier — endre hva som helst ─
const DEFAULTS = {
  lang: 'en',            // 'en' | 'ar' | 'no'
  title: 'Barcode Desk',
  currency: 'YER',       // default for new products: 'YER' | 'SAR' | 'USD' (each product can differ)
  prefix: '2',           // codes start with this; «2» = GS1's in-store range
  accent: '#1b5e20',
  sound: true,
  columns: 3,            // labels per row on the printed sheet
  labelName: true,
  labelPrice: true,
};

// ── 1 · EAN-13 ───────────────────────────────────────────────────────────────
/** The 13th digit: weighted sum (1,3,1,3…) of the first 12, rounded up to a ten. */
export function checkDigit(body12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** A new code that is not in `taken`. Random bytes ≥ 250 are dropped so every digit is equally likely. */
export function newCode(prefix = '2', taken = new Set()) {
  if (!/^\d{1,11}$/.test(prefix)) prefix = '2';
  for (;;) {
    let body = prefix;
    const bytes = new Uint8Array(12);
    while (body.length < 12) {
      crypto.getRandomValues(bytes);
      for (const b of bytes) if (b < 250 && body.length < 12) body += String(b % 10);
    }
    const code = body + checkDigit(body);
    if (!taken.has(code)) return code;
  }
}

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = L.map(p => [...p].map(b => (b === '0' ? '1' : '0')).join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** 95 black/white modules: guard · 6 digits · middle · 6 digits · guard. */
export function toModules(code) {
  const parity = PARITY[Number(code[0])];
  let bits = '101';
  for (let i = 0; i < 6; i++) bits += (parity[i] === 'L' ? L : G)[Number(code[i + 1])];
  bits += '01010';
  for (let i = 7; i < 13; i++) bits += R[Number(code[i])];
  return bits + '101';
}

/** The barcode as SVG. No fixed size: it fills whatever box it is put in. */
export function labelSvg(code) {
  const bits = toModules(code), quiet = 10, w = bits.length + quiet * 2, bh = 58;
  let bars = '';
  for (let i = 0; i < bits.length;) {
    if (bits[i] === '0') { i++; continue; }
    let j = i; while (bits[j] === '1') j++;
    bars += `<rect x="${quiet + i}" y="0" width="${j - i}" height="${bh}"/>`;
    i = j;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${bh + 12}" shape-rendering="crispEdges" style="width:100%;height:auto">` +
    `<rect width="${w}" height="${bh + 12}" fill="#fff"/><g fill="#000">${bars}</g>` +
    `<text x="${w / 2}" y="${bh + 9}" font-family="monospace" font-size="9" text-anchor="middle">${code}</text></svg>`;
}

// ── 2 · Money and digits / Penger og sifre ───────────────────────────────────
// Prices are whole numbers of cents, never floats. Arabic-Indic digits are accepted.
const toLatin = s => String(s)
  .replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x660)
  .replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x6f0)
  .replace(/[٫,]/g, '.');
export function toMinor(text) {
  const clean = toLatin(text).replace(/[^\d.]/g, '');
  const n = Number(clean);
  return /\d/.test(clean) && Number.isFinite(n) ? Math.round(n * 100) : null;   // «abc» has no digit → refused
}
/** Decimals shown per currency: the Yemeni riyal is normally written without fractions. */
export const CURRENCIES = { YER: 0, SAR: 2, USD: 2 };   // order = order in the drop-down
export function formatMoney(minor, cur) {
  const d = CURRENCIES[cur] ?? 2;
  return `${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })} ${cur}`;
}
const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

// ── 3 · Words, in three languages / Ord, på tre språk ────────────────────────
const WORDS = {
  en: {
    products: 'Products', scan: 'Scan', settings: 'Settings', name: 'Name', price: 'Price',
    add: 'Add product', save: 'Save', cancel: 'Cancel', edit: 'Edit', del: 'Delete', sure: 'Sure?',
    empty: 'No products yet. Add the first one above.', all: 'All', none: 'None', print: 'Print', share: 'Share PDF', noShare: 'Sharing is not available here.', makingPdf: 'Making PDF…',
    startScan: 'Scan with camera', typeCode: 'Type or scan a code', go: 'Add', scanned: 'Scanned', kinds: 'Products',
    unknownT: 'Unknown', value: 'Value', known: 'Scanned products', unknownList: 'Unknown barcodes',
    notKnown: 'not known', reset: 'Reset counts', product: 'Product', count: 'Count',
    noScanner: 'No camera scanner here. Type the code, or use a Bluetooth/USB scanner.',
    scanFail: 'The scanner could not start.', noPrint: 'Printing is not available here.',
    lang: 'Language', titleL: 'Screen title', currency: 'Default currency', prefix: 'Code prefix (digits)', accent: 'Accent colour', columns: 'Labels per row',
    showName: 'Name on label', showPrice: 'Price on label', sound: 'Sound', test: 'Test sound',
    nameReq: 'Enter a name.', priceReq: 'Enter a valid price.', added: 'Added', saved: 'Saved', nothingSel: 'Select products to print.',
    nothingToScan: 'Nothing scanned yet.', total: 'Total', last: 'Last scan',
  },
  ar: {
    products: 'المنتجات', scan: 'مسح', settings: 'الإعدادات', name: 'الاسم', price: 'السعر',
    add: 'إضافة منتج', save: 'حفظ', cancel: 'إلغاء', edit: 'تعديل', del: 'حذف', sure: 'متأكد؟',
    empty: 'لا توجد منتجات بعد. أضف أول منتج أعلاه.', all: 'الكل', none: 'لا شيء', print: 'طباعة', share: 'مشاركة PDF', noShare: 'المشاركة غير متاحة هنا.', makingPdf: 'جارٍ إنشاء PDF…',
    startScan: 'مسح بالكاميرا', typeCode: 'اكتب الرمز أو امسحه', go: 'إضافة', scanned: 'ممسوح', kinds: 'المنتجات',
    unknownT: 'غير معروف', value: 'القيمة', known: 'المنتجات الممسوحة', unknownList: 'رموز غير معروفة',
    notKnown: 'غير معروف', reset: 'تصفير العدّ', product: 'المنتج', count: 'العدد',
    noScanner: 'لا يوجد ماسح بالكاميرا هنا. اكتب الرمز أو استخدم ماسحاً بلوتوث/USB.',
    scanFail: 'تعذّر تشغيل الماسح.', noPrint: 'الطباعة غير متاحة هنا.',
    lang: 'اللغة', titleL: 'عنوان الشاشة', currency: 'العملة الافتراضية', prefix: 'بادئة الرمز (أرقام)', accent: 'لون التمييز', columns: 'ملصقات في الصف',
    showName: 'الاسم على الملصق', showPrice: 'السعر على الملصق', sound: 'الصوت', test: 'تجربة الصوت',
    nameReq: 'أدخل الاسم.', priceReq: 'أدخل سعراً صحيحاً.', added: 'تمت الإضافة', saved: 'تم الحفظ', nothingSel: 'اختر منتجات للطباعة.',
    nothingToScan: 'لم يُمسح شيء بعد.', total: 'المجموع', last: 'آخر مسح',
  },
  no: {
    products: 'Varer', scan: 'Skann', settings: 'Innstillinger', name: 'Navn', price: 'Pris',
    add: 'Legg til vare', save: 'Lagre', cancel: 'Avbryt', edit: 'Rediger', del: 'Slett', sure: 'Sikker?',
    empty: 'Ingen varer ennå. Legg til den første ovenfor.', all: 'Alle', none: 'Ingen', print: 'Skriv ut', share: 'Del PDF', noShare: 'Deling er ikke tilgjengelig her.', makingPdf: 'Lager PDF…',
    startScan: 'Skann med kamera', typeCode: 'Skriv eller skann en kode', go: 'Legg til', scanned: 'Skannet', kinds: 'Varer',
    unknownT: 'Ukjent', value: 'Verdi', known: 'Skannede varer', unknownList: 'Ukjente strekkoder',
    notKnown: 'ikke kjent', reset: 'Nullstill telling', product: 'Vare', count: 'Antall',
    noScanner: 'Ingen kameraskanner her. Skriv koden, eller bruk en Bluetooth/USB-skanner.',
    scanFail: 'Skanneren kunne ikke starte.', noPrint: 'Utskrift er ikke tilgjengelig her.',
    lang: 'Språk', titleL: 'Skjermtittel', currency: 'Standardvaluta', prefix: 'Kodeprefiks (sifre)', accent: 'Aksentfarge', columns: 'Etiketter per rad',
    showName: 'Navn på etiketten', showPrice: 'Pris på etiketten', sound: 'Lyd', test: 'Test lyd',
    nameReq: 'Skriv et navn.', priceReq: 'Skriv en gyldig pris.', added: 'Lagt til', saved: 'Lagret', nothingSel: 'Velg varer å skrive ut.',
    nothingToScan: 'Ingenting skannet ennå.', total: 'Sum', last: 'Siste skann',
  },
};

// ── 4 · Sound: a bright beep for known, a low double beep for unknown ────────
// Generated, not a file: nothing to bundle, and it works offline. An AudioContext
// may only start from a tap, so unlock() is called from button handlers.
// Generert, ikke en fil: ingenting å pakke, og det virker offline.
let audio = null;
function audioCtx() {
  if (audio) return audio;
  const C = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!C) return null;
  try { audio = new C(); } catch { audio = null; }
  return audio;
}
const unlock = () => { const c = audioCtx(); if (c && c.state === 'suspended') c.resume().catch(() => {}); };
function tone(freq, startIn, length, volume) {
  const c = audioCtx(); if (!c) return;
  try {
    const osc = c.createOscillator(), gain = c.createGain(), t0 = c.currentTime + startIn;
    osc.type = 'square'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.008);
    gain.gain.setValueAtTime(volume, t0 + length - 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
    osc.connect(gain).connect(c.destination); osc.start(t0); osc.stop(t0 + length + 0.02);
  } catch { /* sound is a nicety, never a reason to fail */ }
}
const beepOk = () => tone(2000, 0, 0.12, 0.25);
const beepBad = () => { tone(260, 0, 0.14, 0.3); tone(260, 0.2, 0.14, 0.3); };

// ── 4b · Labels as a PDF — for sharing / Etiketter som PDF — for deling ───────
// No library: a PDF page can simply hold one JPEG picture. The pictures are drawn
// on a canvas, so the browser shapes the Arabic and uses the Tajawal Bold font.
// Ingen bibliotek: en PDF-side kan bare inneholde ett JPEG-bilde. Bildene tegnes på
// et canvas, så nettleseren former arabisk og bruker Tajawal Bold.
const A4 = [595.28, 841.89];                                   // points
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

/** The label sheet drawn on A4-shaped canvases (150 dpi), as JPEG pages. */
export async function renderSheetPages(list, s) {
  const W = 1240, H = 1754, M = 59, cols = Number(s.columns) || 3, rtl = s.lang === 'ar';
  const cellW = Math.floor((W - 2 * M) / cols), padX = Math.round(cellW * 0.1), padY = 40;
  const barW = cellW - 2 * padX, unit = barW / 115, barH = Math.round(70 * unit);
  const nameLines = s.labelName ? 2 : 0, NAME = 34, NAME_LH = 44, PRICE_LH = 42;
  const cellH = padY + barH + 16 + nameLines * NAME_LH + (s.labelPrice ? PRICE_LH : 0) + padY;
  const rows = Math.max(1, Math.floor((H - 2 * M) / cellH)), perPage = rows * cols;
  try { await document.fonts?.load("700 20px 'Tajawal'"); } catch { /* falls back to a system face */ }

  const pages = [];
  for (let start = 0; start < Math.max(list.length, 1); start += perPage) {
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#666'; g.lineWidth = 2; g.setLineDash([10, 8]);
    list.slice(start, start + perPage).forEach((p, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = M + (rtl ? cols - 1 - col : col) * cellW, y = M + row * cellH;
      g.strokeRect(x, y, cellW, cellH);
      // bars
      g.fillStyle = '#000';
      const bits = toModules(p.code), bx = x + padX, by = y + padY;
      for (let k = 0; k < bits.length;) {
        if (bits[k] === '0') { k++; continue; }
        let j = k; while (bits[j] === '1') j++;
        g.fillRect(bx + (10 + k) * unit, by, (j - k) * unit, 58 * unit);
        k = j;
      }
      g.textAlign = 'center'; g.textBaseline = 'top';
      g.font = `${Math.round(10 * unit)}px monospace`; g.direction = 'ltr';
      g.fillText(p.code, bx + barW / 2, by + 59 * unit);
      // name (wrapped to 2 lines) and price
      let ty = by + barH + 16;
      g.direction = rtl ? 'rtl' : 'ltr';
      if (s.labelName) {
        g.font = `700 ${NAME}px 'Tajawal', sans-serif`;
        const lines = []; let cur = '';
        for (const word of p.name.split(/\s+/)) {
          const tryLine = cur ? `${cur} ${word}` : word;
          if (cur && g.measureText(tryLine).width > barW) { lines.push(cur); cur = word; } else cur = tryLine;
        }
        if (cur) lines.push(cur);
        lines.slice(0, 2).forEach((l, k) => g.fillText(l, bx + barW / 2, ty + k * NAME_LH));
        ty += 2 * NAME_LH;
      }
      if (s.labelPrice) { g.font = `700 30px 'Tajawal', sans-serif`; g.fillText(formatMoney(p.price, p.currency || s.currency), bx + barW / 2, ty); }
    });
    pages.push({ jpeg: base64ToBytes(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]), w: W, h: H });
  }
  return pages;
}

// ── 5 · A tiny DOM helper / En liten DOM-hjelper ─────────────────────────────
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
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(kid));
  return e;
}

/** The barcode drawing inside a small box (built from our own SVG string, never from user text). */
function barcodeBox(code) {
  const box = h('div', { class: 'barbox' });
  box.innerHTML = labelSvg(code);
  return box;
}

// ── 4c · Icons (inline SVG, no files) / Ikoner (innebygd SVG, ingen filer) ─────
const ICONS = {
  products: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M7.5 8v8M10.5 8v8M13.5 8v8M16.5 8v8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l5 5L19 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13 7l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
};
function icon(name, size = 26) {
  const span = document.createElement('span');
  span.className = 'ic';
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return span;
}
/** An icon-only button. The label is for screen readers and the long-press tooltip. */
const iconBtn = (name, label, cls, act, onclick, size) =>
  h('button', { class: `ib ${cls}`, 'aria-label': label, title: label, 'data-act': act, onclick }, icon(name, size));

const CSS = `
.bd{font-family:'Tajawal',system-ui,sans-serif;font-weight:700;color:#1b1b1b;background:#f4f6f4;min-height:100%;padding:12px 12px 90px;box-sizing:border-box}
.bd *{font-family:inherit;font-weight:700;box-sizing:border-box}
.bd h1{margin:4px 0 12px;font-size:32px;color:var(--bd-accent)}
.bd .tabs{display:flex;gap:6px;margin-bottom:12px}
.bd .tabs button{flex:1;height:54px;display:flex;align-items:center;justify-content:center;border:0;border-radius:12px;background:#e3e8e3;color:#444}
.bd .tabs button.on{background:var(--bd-accent);color:#fff}
.bd .card{background:#fff;border-radius:12px;padding:12px;margin-bottom:10px;box-shadow:0 1px 3px #0002}
.bd input[type=text],.bd select{width:100%;padding:10px;margin:4px 0 8px;border:1px solid #bbb;border-radius:8px;font-size:19px;
  /* Old Android WebViews (Note 9) paint a FOCUSED non-opaque input as a solid box that hides the text.
     Fix: opaque background + explicit colour + text-fill-colour, no native look, no effects.
     Gamle Android-WebViews maler et FOKUSERT gjennomsiktig felt som en heldekkende boks. */
  background:#ffffff;color:#111111;-webkit-text-fill-color:#111111;caret-color:#111111;opacity:1;filter:none;transform:none;
  -webkit-appearance:none;appearance:none;color-scheme:light;outline:none}
.bd input[type=text]:focus,.bd select:focus{background:#ffffff;color:#111111;-webkit-text-fill-color:#111111;border-color:var(--bd-accent)}
.bd input::placeholder{color:#888;-webkit-text-fill-color:#888;opacity:1}
.bd label{display:block;font-size:16px;color:#555}
.bd .row{display:flex;gap:8px;align-items:center}
.bd .grow{flex:1;min-width:0}
.bd button.pri,.bd button.sec,.bd button.dng{padding:12px 16px;border-radius:10px;border:0;font-size:18px}
.bd button.pri{background:var(--bd-accent);color:#fff}
.bd button.sec{background:#e3e8e3;color:#222}
.bd button.dng{background:#c62828;color:#fff}
.bd button.sec.dng{background:#fde8e8;color:#c62828}
.bd .item .top{display:flex;gap:10px;align-items:center}
.bd .item .top input{width:22px;height:22px;flex:none}
.bd .item .info{flex:1;min-width:0}
.bd .item .info b{display:block;font-size:22px;overflow-wrap:anywhere}
.bd .item .info span{color:var(--bd-accent);font-size:20px}
.bd .barbox{background:#fff;border:1px solid #cfd6cf;border-radius:10px;padding:10px 12px;margin:10px auto 6px;max-width:264px}   /* was 352px: 25% smaller, both ways (the SVG keeps its proportions) */
.bd .barbox svg{display:block;width:100%;height:auto}
.bd .item .acts{justify-content:center;gap:16px}
.bd .ib{width:50px;height:50px;border:0;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;padding:0;flex:none}
.bd .ib.pri{background:var(--bd-accent);color:#fff}.bd .ib.sec{background:#e3e8e3;color:#222}
.bd .ib.dng{background:#fde8e8;color:#c62828}.bd .ib.dng.solid{background:#c62828;color:#fff}
.bd .ib.grow{width:auto}
.bd .seg{display:flex;gap:6px;margin:4px 0 8px}
.bd .seg button{flex:1;padding:10px 0;border:2px solid #cfd6cf;border-radius:10px;background:#fff;font-size:15px;color:#333}
.bd .seg button.on{border-color:var(--bd-accent);background:var(--bd-accent);color:#fff}
.bd select[data-f=cur]{width:auto;min-width:0;display:block;padding:8px 32px 8px 14px;margin:4px 0 10px;font-size:18px;border:0;border-radius:8px;
  background:var(--bd-accent) url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'><path d='M1 1l5 5 5-5' fill='none' stroke='white' stroke-width='2'/></svg>") no-repeat right 10px center;
  color:#fff;-webkit-text-fill-color:#fff}
.bd[dir=rtl] select[data-f=cur]{padding:7px 12px 7px 30px;background-position:left 10px center}
.bd select[data-f=cur] option{color:#111;background:#fff;-webkit-text-fill-color:#111}
.bd .stats b.sm{font-size:14px;white-space:pre-line;line-height:1.3}
.bd .muted{color:#777;font-size:16px}
.bd .acts{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}
.bd .big{border-radius:14px;padding:18px;text-align:center;font-size:24px;margin-bottom:10px;color:#fff}
.bd .big.ok{background:#2e7d32}.bd .big.bad{background:#c62828}
.bd .big small{display:block;font-size:14px;opacity:.9;margin-top:4px}
.bd .stats{display:flex;gap:8px;margin-bottom:10px}
.bd .stats div{flex:1;background:#fff;border-radius:10px;padding:8px;text-align:center;box-shadow:0 1px 3px #0002}
.bd .stats b{display:block;font-size:24px;color:var(--bd-accent)}
.bd .stats span{font-size:14px;color:#666}
.bd table{width:100%;border-collapse:collapse}
.bd td{padding:10px 4px;border-bottom:1px solid #eee;font-size:18px}
.bd td.n{text-align:center;width:60px}
.bd td.unk{color:#c62828}
.bd .toast{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);background:#222;color:#fff;padding:10px 16px;border-radius:20px;font-size:14px;max-width:90%;z-index:50}
.bd .toast.bad{background:#c62828}
.bd .chk{display:flex;gap:10px;align-items:center;margin:10px 0;font-size:18px;color:#222}
.bd .chk input{width:20px;height:20px}
`;

// ── 6 · The screen / Skjermen ────────────────────────────────────────────────
export function mount(el, ctx) {
  const store = ctx.storage;
  const userSettings = store.get('settings', {});
  const S = () => ({ ...DEFAULTS, ...(ctx.options || {}), ...userSettings });
  let products = store.get('products', []);           // [{ code, name, price(cents), createdAt }]
  let session = store.get('session', {});             // { code: count }
  let tab = 'products', editing = null, last = null, scanning = false, alive = true, confirm = null, typed = '';
  let draft = { name: '', price: '', cur: null };   // cur null = the default currency
  const selected = new Set(products.map(p => p.code));

  const t = k => WORDS[S().lang]?.[k] ?? WORDS.en[k];
  const save = () => { store.set('products', products); store.set('session', session); };
  const known = () => new Map(products.map(p => [p.code, p]));

  const root = h('div', { class: 'bd' });
  const style = h('style', {}, CSS);
  const toast = h('div', { class: 'toast' }); toast.hidden = true;
  let toastTimer = 0;
  function flash(msg, bad = false) {
    toast.textContent = msg; toast.className = 'toast' + (bad ? ' bad' : ''); toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
  }

  // ── products ──
  function submitProduct() {
    const name = draft.name.trim(); const price = toMinor(draft.price.trim());
    if (!name) return flash(t('nameReq'), true);
    if (price == null) return flash(t('priceReq'), true);
    if (editing) {
      const p = products.find(x => x.code === editing);
      if (p) { p.name = name; p.price = price; p.currency = draft.cur || p.currency || S().currency; }
      editing = null; flash(t('saved'));
    } else {
      const code = newCode(S().prefix, new Set(products.map(p => p.code)));
      products.unshift({ code, name, price, currency: draft.cur || S().currency, createdAt: Date.now() });
      selected.add(code); flash(t('added'));
    }
    draft = { name: '', price: '', cur: null }; save(); render();
  }
  function startEdit(p) { editing = p.code; draft = { name: p.name, price: (p.price / 100).toFixed(2), cur: p.currency || S().currency }; render(); }
  function removeProduct(code) {
    if (confirm !== code) { confirm = code; render(); return; }
    products = products.filter(p => p.code !== code); selected.delete(code); confirm = null; save(); render();
  }

  async function labelsHtml(list) {
    const s = S();
    const font = ctx.fontCss ? await ctx.fontCss().catch(() => '') : '';
    const cells = list.map(p =>
      `<div class="l">${labelSvg(p.code)}${s.labelName ? `<b>${esc(p.name)}</b>` : ''}${s.labelPrice ? `<i>${esc(formatMoney(p.price, p.currency || s.currency))}</i>` : ''}</div>`);
    // One dashed cutting line between neighbours, blank paper round every barcode.
    // Én stiplet kuttelinje mellom naboer, blankt papir rundt hver strekkode.
    return `<!doctype html><html lang="${s.lang}" dir="${s.lang === 'ar' ? 'rtl' : 'ltr'}"><meta charset="utf-8"><title>${esc(s.title)}</title>
<style>${font}
@page{size:A4;margin:10mm}
body{font-family:'Tajawal',Arial,sans-serif;font-weight:700;margin:0}
.sheet{display:grid;grid-template-columns:repeat(${Number(s.columns) || 3},1fr);border-top:1px dashed #666;border-left:1px dashed #666}
.l{border-right:1px dashed #666;border-bottom:1px dashed #666;padding:7mm 6mm;text-align:center;break-inside:avoid;display:flex;flex-direction:column;align-items:center;gap:1.5mm}
.l b{font-size:13pt;line-height:1.3}.l i{font-style:normal;font-size:12pt}
</style><div class="sheet">${cells.join('')}</div></html>`;
  }
  async function printSelected() {
    const list = products.filter(p => selected.has(p.code));
    if (!list.length) return flash(t('nothingSel'), true);
    if (!ctx.print) return flash(t('noPrint'), true);
    try { await ctx.print(await labelsHtml(list), S().title); } catch (e) { flash(e.message || t('noPrint'), true); }
  }

  async function shareSelected() {
    const list = products.filter(p => selected.has(p.code));
    if (!list.length) return flash(t('nothingSel'), true);
    if (!ctx.share) return flash(t('noShare'), true);
    try {
      flash(t('makingPdf'));
      const pdf = buildPdf(await renderSheetPages(list, S()));
      const day = new Date().toISOString().slice(0, 10);
      await ctx.share(`labels-${day}.pdf`, bytesToBase64(pdf), 'application/pdf');
    } catch (e) { flash(e.message || t('noShare'), true); }
  }

  // ── scanning ──
  function handleCode(raw) {
    const code = String(raw).trim(); if (!code) return;
    session[code] = (session[code] || 0) + 1; save();
    const p = known().get(code);
    last = p ? { ok: true, name: p.name, count: session[code] } : { ok: false, code };
    if (S().sound) (p ? beepOk : beepBad)();
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function scanLoop() {
    if (scanning || !ctx.scan) return;
    scanning = true; unlock(); render();
    try {
      // Continuous: after each code the result shows for a moment, then the scanner opens again.
      // Back out of the scanner to stop. / Gå ut av skanneren for å stoppe.
      while (alive) {
        const code = await ctx.scan();
        if (code == null) break;
        handleCode(code); render();
        await sleep(900);
      }
    } catch (e) { flash(e.message || t('scanFail'), true); }
    scanning = false; if (alive) render();
  }
  function typedGo() { unlock(); handleCode(typed); typed = ''; render(); }
  function decrement(code) {
    if ((session[code] || 0) <= 1) delete session[code]; else session[code]--;
    save(); render();
  }

  // ── views ──
  function productsView() {
    const s = S();
    const cur = draft.cur || s.currency;
    const form = h('div', { class: 'card' },
      h('label', {}, t('name')),
      h('input', { type: 'text', 'data-f': 'name', value: draft.name, oninput: e => { draft.name = e.target.value; } }),
      h('label', {}, t('price')),
      h('input', { type: 'text', inputmode: 'decimal', 'data-f': 'price', value: draft.price, oninput: e => { draft.price = e.target.value; } }),
      h('select', { 'data-f': 'cur', 'aria-label': t('currency'), onchange: e => { draft.cur = e.target.value; } },
        Object.keys(CURRENCIES).map(c => h('option', { value: c, selected: c === cur }, c))),
      h('div', { class: 'row' },
        iconBtn(editing ? 'check' : 'plus', editing ? t('save') : t('add'), 'pri grow', 'add', submitProduct, 30),
        editing && iconBtn('x', t('cancel'), 'sec', 'cancel', () => { editing = null; draft = { name: '', price: '', cur: null }; render(); })));

    const countLabel = h('span', { class: 'muted' });
    const refreshCount = () => { countLabel.textContent = `${selected.size} / ${products.length}`; };
    refreshCount();
    const bar = products.length ? h('div', { class: 'row', style: 'margin-bottom:10px' },
      iconBtn('check', t('all'), 'sec', 'all', () => { products.forEach(p => selected.add(p.code)); render(); }),
      iconBtn('x', t('none'), 'sec', 'none', () => { selected.clear(); render(); }),
      countLabel, h('span', { class: 'grow' }),
      iconBtn('print', t('print'), 'pri', 'print', printSelected),
      iconBtn('share', t('share'), 'pri', 'share', shareSelected)) : null;

    const list = products.length === 0
      ? h('p', { class: 'muted' }, t('empty'))
      : products.map(p => h('div', { class: 'card item', 'data-code': p.code },
          h('div', { class: 'top' },
            h('input', { type: 'checkbox', checked: selected.has(p.code), onchange: e => { e.target.checked ? selected.add(p.code) : selected.delete(p.code); refreshCount(); } }),
            h('div', { class: 'info' }, h('b', {}, p.name), h('span', {}, formatMoney(p.price, p.currency || s.currency)))),
          barcodeBox(p.code),                                   // big, on its own line
          h('div', { class: 'acts' },                           // edit + delete UNDER the barcode
            iconBtn('edit', t('edit'), 'sec', 'edit', () => startEdit(p)),
            iconBtn(confirm === p.code ? 'check' : 'trash', confirm === p.code ? t('sure') : t('del'),
              confirm === p.code ? 'dng solid' : 'dng', 'del', () => removeProduct(p.code)))));
    return [form, bar, list];
  }

  function scanView() {
    const s = S(), map = known();
    const rows = Object.entries(session);
    const knownRows = rows.filter(([c]) => map.has(c)).map(([c, n]) => ({ p: map.get(c), c, n }));
    const unknownRows = rows.filter(([c]) => !map.has(c)).map(([c, n]) => ({ c, n }));
    const sum = a => a.reduce((x, r) => x + r.n, 0);
    const totals = {};                                   // one total per currency, never mixed
    knownRows.forEach(r => { const c = r.p.currency || s.currency; totals[c] = (totals[c] || 0) + r.p.price * r.n; });
    const value = Object.entries(totals).map(([c, v]) => formatMoney(v, c)).join('\n') || '0';

    return [
      ctx.scan
        ? h('button', { class: 'pri', style: 'width:100%;margin-bottom:10px;font-size:18px', 'data-act': 'scan', onclick: scanLoop }, '📷 ' + t('startScan'))
        : h('p', { class: 'muted' }, t('noScanner')),
      h('div', { class: 'row' },
        h('input', { type: 'text', inputmode: 'numeric', class: 'grow', 'data-f': 'typed', placeholder: t('typeCode'), value: typed,
          oninput: e => { typed = e.target.value; }, onkeydown: e => { if (e.key === 'Enter') typedGo(); } }),
        iconBtn('plus', t('go'), 'pri', 'go', typedGo, 28)),
      last && h('div', { class: 'big ' + (last.ok ? 'ok' : 'bad'), 'data-last': last.ok ? 'ok' : 'bad' },
        last.ok ? `✓ ${last.name}  × ${last.count}` : `✗ ${last.code}`,
        h('small', {}, last.ok ? t('last') : t('notKnown'))),
      h('div', { class: 'stats' },
        h('div', {}, h('b', { 'data-stat': 'scanned' }, String(sum(knownRows))), h('span', {}, t('scanned'))),
        h('div', {}, h('b', {}, String(knownRows.length)), h('span', {}, t('kinds'))),
        h('div', {}, h('b', { 'data-stat': 'unknown' }, String(sum(unknownRows))), h('span', {}, t('unknownT'))),
        h('div', {}, h('b', { class: 'sm', 'data-stat': 'value' }, value), h('span', {}, t('value')))),
      rows.length === 0 ? h('p', { class: 'muted' }, t('nothingToScan')) : null,
      knownRows.length ? h('div', { class: 'card' }, h('div', { class: 'muted' }, t('known')),
        h('table', {}, knownRows.map(r => h('tr', { 'data-row': r.c },
          h('td', {}, r.p.name), h('td', { class: 'n' }, '× ' + r.n),
          h('td', { class: 'n' }, h('button', { class: 'sec', onclick: () => decrement(r.c) }, '−')))))) : null,
      unknownRows.length ? h('div', { class: 'card' }, h('div', { class: 'muted' }, t('unknownList')),
        h('table', {}, unknownRows.map(r => h('tr', { 'data-unknown': r.c },
          h('td', { class: 'unk' }, `${r.c} — ${t('notKnown')}`), h('td', { class: 'n' }, '× ' + r.n),
          h('td', { class: 'n' }, h('button', { class: 'sec', onclick: () => decrement(r.c) }, '−')))))) : null,
      rows.length ? h('div', { class: 'acts', style: 'justify-content:center' },
        iconBtn(confirm === '#reset' ? 'check' : 'trash', confirm === '#reset' ? t('sure') : t('reset'),
          confirm === '#reset' ? 'dng solid' : 'dng', 'reset',
          () => { if (confirm !== '#reset') { confirm = '#reset'; render(); return; } session = {}; last = null; confirm = null; save(); render(); })) : null,
    ];
  }

  function settingsView() {
    const s = S();
    const set = (k, v) => { userSettings[k] = v; store.set('settings', userSettings); render(); };
    const field = (label, input) => h('div', {}, h('label', {}, label), input);
    const sel = (key, opts) => h('select', { 'data-s': key, onchange: e => set(key, typeof DEFAULTS[key] === 'number' ? Number(e.target.value) : e.target.value) },
      opts.map(([v, l]) => h('option', { value: v, selected: String(s[key]) === String(v) }, l)));
    const text = key => h('input', { type: 'text', 'data-s': key, value: s[key], onchange: e => set(key, e.target.value) });
    const check = (key, label) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', 'data-s': key, checked: !!s[key], onchange: e => set(key, e.target.checked) }), label);
    return h('div', { class: 'card' },
      field(t('lang'), sel('lang', [['en', 'English'], ['ar', 'العربية'], ['no', 'Norsk']])),
      field(t('titleL'), text('title')),
      field(t('currency'), sel('currency', Object.keys(CURRENCIES).map(c => [c, c]))),
      field(t('prefix'), h('input', { type: 'text', inputmode: 'numeric', 'data-s': 'prefix', value: s.prefix,
        onchange: e => set('prefix', /^\d{1,11}$/.test(e.target.value) ? e.target.value : DEFAULTS.prefix) })),
      field(t('accent'), h('input', { type: 'color', 'data-s': 'accent', value: s.accent, style: 'width:100%;height:42px;margin:4px 0 8px', onchange: e => set('accent', e.target.value) })),
      field(t('columns'), sel('columns', [[2, '2'], [3, '3'], [4, '4']])),
      check('labelName', t('showName')), check('labelPrice', t('showPrice')),
      check('sound', t('sound')),
      h('div', { class: 'row' },
        iconBtn('check', t('test'), 'sec', 'test-ok', () => { unlock(); beepOk(); }),
        iconBtn('x', t('test'), 'sec', 'test-bad', () => { unlock(); beepBad(); })));
  }

  function render() {
    if (!alive) return;
    const s = S();
    root.style.setProperty('--bd-accent', s.accent);
    root.dir = s.lang === 'ar' ? 'rtl' : 'ltr';
    const tabs = [['products', t('products')], ['scan', t('scan')], ['settings', t('settings')]];
    const view = tab === 'products' ? productsView() : tab === 'scan' ? scanView() : settingsView();
    root.replaceChildren(
      h('h1', {}, s.title),
      h('div', { class: 'tabs' }, tabs.map(([id, label]) =>
        h('button', { class: id === tab ? 'on' : '', 'data-tab': id, 'aria-label': label, title: label,
          onclick: () => { tab = id; confirm = null; render(); } }, icon(id, 30)))),
      ...[view].flat(Infinity).filter(Boolean), toast);
  }

  el.replaceChildren(style, root);
  render();
  return () => { alive = false; scanning = false; clearTimeout(toastTimer); };
}

// ── 7 · The only door into the host / Den eneste døren inn til verten ─────────
export function register(host) {
  // A headless host (command line) has no screens; the plugin simply offers nothing there.
  host.screen?.({ id: 'desk', title: DEFAULTS.title, icon: '🏷️', mount });
}
