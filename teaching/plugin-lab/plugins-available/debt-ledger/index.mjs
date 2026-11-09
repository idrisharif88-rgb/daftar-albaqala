/**
 * PLUGIN · Debt Ledger — one screen, zero dependencies, fully offline.
 * PLUGIN · Gjeldsbok — én skjerm, null avhengigheter, helt offline.
 *
 * EN: Contacts → record a DEBT (they owe you) or a PAYMENT (they paid) → a running
 *     balance per currency → a PDF statement to print or share. It knows nothing
 *     about any particular app: it asks the HOST for storage, printing and sharing.
 * NO: Kontakter → registrer en GJELD (de skylder deg) eller en BETALING (de har
 *     betalt) → løpende saldo per valuta → en PDF-kontoutskrift å skrive ut eller
 *     dele. Den kjenner ingen bestemt app: den ber VERTEN om lager, utskrift og deling.
 *
 * Rules taken from Daftar, kept here on purpose / Regler fra Daftar:
 *   · Entries are APPEND-ONLY. A mistake is fixed with an opposite entry (a reversal),
 *     never by editing or deleting — so the book still adds up and can be audited.
 *   · Money is whole cents, never floats. Each entry carries its OWN currency, and
 *     balances are never mixed across currencies.
 *   · Contacts are editable and soft-deleted (hidden, history kept).
 *   · Balance > 0 → «owes you» (red). Balance < 0 → «you owe» (green). 0 → settled.
 */

// ── 0 · Defaults — change anything here / Standardverdier ────────────────────
const DEFAULTS = {
  lang: 'en',               // 'en' | 'ar' | 'no'
  title: 'Debt Ledger',
  shop: '',                 // printed at the top of every statement
  currency: 'YER',          // default for new entries: 'YER' | 'SAR' | 'USD'
  accent: '#1b5e20',
  footer: '',
};

// ── 1 · Money, balances, statements (pure — easy to test) / Rene funksjoner ───
const toLatin = s => String(s)
  .replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x660)
  .replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x6f0)
  .replace(/[٫,]/g, '.');
export function toMinor(text) {
  const clean = toLatin(text).replace(/[^\d.]/g, '');
  const n = Number(clean);
  return /\d/.test(clean) && Number.isFinite(n) ? Math.round(n * 100) : null;
}
/** Decimals per currency: the Yemeni riyal is normally written without fractions. */
export const CURRENCIES = { YER: 0, SAR: 2, USD: 2 };
export function formatMoney(minor, cur) {
  const d = CURRENCIES[cur] ?? 2;
  return `${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })} ${cur}`;
}
const pad = n => String(n).padStart(2, '0');
export const fmtDay = iso => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const fmtDate = iso => `${fmtDay(iso)} ${pad(new Date(iso).getHours())}:${pad(new Date(iso).getMinutes())}`;
const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sign = e => (e.type === 'debt' ? 1 : -1);

/** One contact's balance per currency: debts add, payments subtract. { YER: 15000, USD: -500 } */
export function balanceOf(entries, contactId) {
  const bal = {};
  for (const e of entries) if (e.contactId === contactId) bal[e.currency] = (bal[e.currency] || 0) + sign(e) * e.amount;
  return bal;
}
/** The whole book per currency. Each contact is netted FIRST, then classified (owed to you / you owe). */
export function bookTotals(contacts, entries) {
  const totals = {};
  for (const c of contacts) {
    for (const [cur, v] of Object.entries(balanceOf(entries, c.id))) {
      const t = totals[cur] || (totals[cur] = { toCollect: 0, toPay: 0 });
      if (v > 0) t.toCollect += v; else if (v < 0) t.toPay += -v;
    }
  }
  return totals;
}
/** Ids of entries that already have a reversal — an entry can be reversed once, a reversal never. */
export const reversedIds = entries => new Set(entries.filter(e => e.reverses).map(e => e.reverses));
/** The opposite entry that cancels `entry` (same amount and currency). */
export function reversalOf(entry, no, note) {
  return { id: uid(), no, contactId: entry.contactId, type: entry.type === 'debt' ? 'payment' : 'debt',
    amount: entry.amount, currency: entry.currency, note, date: new Date().toISOString(), reverses: entry.id };
}
/** A statement: per currency, oldest first, with a running balance. */
export function buildStatement(entries) {
  const byCur = {};
  for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.no - b.no)) (byCur[e.currency] ||= []).push(e);
  return Object.keys(CURRENCIES).concat(Object.keys(byCur).filter(c => !(c in CURRENCIES))).filter(c => byCur[c]).map(cur => {
    let run = 0;
    const rows = byCur[cur].map(e => { run += sign(e) * e.amount; return { no: e.no, date: e.date, note: e.note, type: e.type, amount: e.amount, balance: run }; });
    return { cur, rows, balance: run };
  });
}

// ── 2 · Words, in three languages / Ord, på tre språk ────────────────────────
const WORDS = {
  en: {
    contacts: 'Contacts', settings: 'Settings', name: 'Name', phone: 'Phone', note: 'Note', search: 'Search',
    add: 'Add contact', save: 'Save', cancel: 'Cancel', edit: 'Edit', del: 'Delete', sure: 'Sure?', back: 'Back',
    debt: 'Debt', payment: 'Payment', amount: 'Amount', settled: 'Settled', owes: 'owes you', owe: 'you owe',
    toCollect: 'To collect', toPay: 'To pay', noContacts: 'No contacts yet. Tap + to add one.', noEntries: 'No entries yet.',
    reverse: 'Reverse', reversed: 'reversed', reversal: 'reversal of', statement: 'Statement', print: 'Print', share: 'Share PDF',
    makingPdf: 'Making PDF…', noPrint: 'Printing is not available here.', noShare: 'Sharing is not available here.',
    nameReq: 'Enter a name.', amountReq: 'Enter an amount above zero.', added: 'Added', saved: 'Saved',
    lang: 'Language', titleL: 'Screen title', shop: 'Name on statement', currency: 'Default currency', accent: 'Accent colour',
    footer: 'Note at the bottom', dateCol: 'Date', noteCol: 'Note', debtCol: 'Debt', payCol: 'Paid', balCol: 'Balance',
    balance: 'Balance', printed: 'Printed', confirmEntry: 'Record', pick: 'Pick from contacts',
  },
  ar: {
    contacts: 'جهات الاتصال', settings: 'الإعدادات', name: 'الاسم', phone: 'الهاتف', note: 'ملاحظة', search: 'بحث',
    add: 'إضافة جهة', save: 'حفظ', cancel: 'إلغاء', edit: 'تعديل', del: 'حذف', sure: 'متأكد؟', back: 'رجوع',
    debt: 'دين', payment: 'دفعة', amount: 'المبلغ', settled: 'مسدد', owes: 'عليه', owe: 'له',
    toCollect: 'لك عندهم', toPay: 'عليك لهم', noContacts: 'لا توجد جهات بعد. اضغط + للإضافة.', noEntries: 'لا توجد حركات بعد.',
    reverse: 'عكس', reversed: 'معكوسة', reversal: 'عكس لـ', statement: 'كشف حساب', print: 'طباعة', share: 'مشاركة PDF',
    makingPdf: 'جارٍ إنشاء PDF…', noPrint: 'الطباعة غير متاحة هنا.', noShare: 'المشاركة غير متاحة هنا.',
    nameReq: 'أدخل الاسم.', amountReq: 'أدخل مبلغاً أكبر من صفر.', added: 'تمت الإضافة', saved: 'تم الحفظ',
    lang: 'اللغة', titleL: 'عنوان الشاشة', shop: 'الاسم في الكشف', currency: 'العملة الافتراضية', accent: 'لون التمييز',
    footer: 'ملاحظة في الأسفل', dateCol: 'التاريخ', noteCol: 'ملاحظة', debtCol: 'دين', payCol: 'مدفوع', balCol: 'الرصيد',
    balance: 'الرصيد', printed: 'تاريخ الطباعة', confirmEntry: 'تسجيل', pick: 'اختيار من جهات الاتصال',
  },
  no: {
    contacts: 'Kontakter', settings: 'Innstillinger', name: 'Navn', phone: 'Telefon', note: 'Notat', search: 'Søk',
    add: 'Legg til kontakt', save: 'Lagre', cancel: 'Avbryt', edit: 'Rediger', del: 'Slett', sure: 'Sikker?', back: 'Tilbake',
    debt: 'Gjeld', payment: 'Betaling', amount: 'Beløp', settled: 'Oppgjort', owes: 'skylder deg', owe: 'du skylder',
    toCollect: 'Til gode', toPay: 'Å betale', noContacts: 'Ingen kontakter ennå. Trykk + for å legge til.', noEntries: 'Ingen poster ennå.',
    reverse: 'Reverser', reversed: 'reversert', reversal: 'reversering av', statement: 'Kontoutskrift', print: 'Skriv ut', share: 'Del PDF',
    makingPdf: 'Lager PDF…', noPrint: 'Utskrift er ikke tilgjengelig her.', noShare: 'Deling er ikke tilgjengelig her.',
    nameReq: 'Skriv et navn.', amountReq: 'Skriv et beløp over null.', added: 'Lagt til', saved: 'Lagret',
    lang: 'Språk', titleL: 'Skjermtittel', shop: 'Navn på utskriften', currency: 'Standardvaluta', accent: 'Aksentfarge',
    footer: 'Merknad nederst', dateCol: 'Dato', noteCol: 'Notat', debtCol: 'Gjeld', payCol: 'Betalt', balCol: 'Saldo',
    balance: 'Saldo', printed: 'Skrevet ut', confirmEntry: 'Registrer', pick: 'Velg fra kontakter',
  },
};

// ── 3 · Statement as a PDF — for sharing / Kontoutskrift som PDF — for deling ──
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

/** The statement drawn on A4-shaped canvases (150 dpi), as JPEG pages. As many pages as it needs. */
export async function renderStatementPages(contact, entries, s, w) {
  const W = 1240, H = 1754, M = 80, ROW = 54, rtl = s.lang === 'ar';
  const inner = W - 2 * M, FR = [0.17, 0.31, 0.16, 0.16, 0.2];   // date · note · debt · paid · balance
  try { await document.fonts?.load("700 20px 'Tajawal'"); } catch { /* falls back to a system face */ }
  const sections = buildStatement(entries);
  // Flatten everything into display rows, then cut into pages.
  const rows = [];
  for (const sec of sections) {
    rows.push({ k: 'section', text: sec.cur });
    rows.push({ k: 'head' });
    sec.rows.forEach(r => rows.push({ k: 'row', cur: sec.cur, r }));
    rows.push({ k: 'bal', text: `${w.balance}: ${formatMoney(Math.abs(sec.balance), sec.cur)} ${sec.balance > 0 ? w.owes : sec.balance < 0 ? w.owe : w.settled}`.trim(), v: sec.balance });
  }
  if (!rows.length) rows.push({ k: 'section', text: w.noEntries });
  const headerH = 330, footerH = s.footer ? 110 : 40;
  const pages = []; let at = 0;
  do {
    const first = pages.length === 0;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.direction = rtl ? 'rtl' : 'ltr'; g.textBaseline = 'middle';
    const edge = rtl ? W - M : M, side = rtl ? 'right' : 'left';
    if (first) {
      g.fillStyle = '#000'; g.textAlign = side;
      g.font = "700 56px 'Tajawal', sans-serif"; g.fillText(s.shop || s.title, edge, M + 40);
      g.font = "700 40px 'Tajawal', sans-serif"; g.fillStyle = s.accent; g.fillText(`${w.statement}: ${contact.name}`, edge, M + 110);
      g.fillStyle = '#000'; g.font = "700 32px 'Tajawal', sans-serif";
      if (contact.phone) g.fillText(contact.phone, edge, M + 162);
      g.fillText(`${w.printed}: ${fmtDay(new Date().toISOString())}`, edge, M + 208);
    }
    const top = first ? M + headerH - 60 : M;
    const room = Math.max(1, Math.floor((H - M - top - footerH) / ROW));
    // column boxes, mirrored for right-to-left
    let x = rtl ? W - M : M;
    const cols = FR.map(f => { const cw = inner * f; const c = rtl ? { x: x - cw, w: cw } : { x, w: cw }; x += rtl ? -cw : cw; return c; });
    rows.slice(at, at + room).forEach((row, i) => {
      const y = top + i * ROW, mid = y + ROW / 2;
      g.font = "700 30px 'Tajawal', sans-serif";
      if (row.k === 'section') { g.fillStyle = s.accent; g.textAlign = side; g.font = "700 38px 'Tajawal', sans-serif"; g.fillText(row.text, edge, mid); return; }
      if (row.k === 'head') {
        g.fillStyle = '#e8f5e9'; g.fillRect(M, y, inner, ROW); g.fillStyle = '#000';
        [w.dateCol, w.noteCol, w.debtCol, w.payCol, w.balCol].forEach((t, c) => { g.textAlign = 'center'; g.fillText(t, cols[c].x + cols[c].w / 2, mid); });
        return;
      }
      if (row.k === 'bal') { g.fillStyle = row.v > 0 ? '#c62828' : row.v < 0 ? '#2e7d32' : '#000'; g.textAlign = side; g.font = "700 38px 'Tajawal', sans-serif"; g.fillText(row.text, edge, mid); return; }
      const r = row.r; g.fillStyle = '#000'; g.textAlign = 'center';
      let note = r.note || ''; while (note.length > 1 && g.measureText(note).width > cols[1].w - 16) note = note.slice(0, -1);
      if (note !== (r.note || '')) note += '…';
      const cells = [fmtDay(r.date), note, r.type === 'debt' ? formatMoney(r.amount, row.cur) : '', r.type === 'payment' ? formatMoney(r.amount, row.cur) : '', formatMoney(r.balance, row.cur)];
      cells.forEach((t, c) => g.fillText(t, cols[c].x + cols[c].w / 2, mid));
      g.strokeStyle = '#ccc'; g.lineWidth = 2; g.beginPath(); g.moveTo(M, y + ROW); g.lineTo(W - M, y + ROW); g.stroke();
    });
    at += room;
    if (at >= rows.length && s.footer) { g.fillStyle = '#000'; g.textAlign = side; g.font = "700 32px 'Tajawal', sans-serif"; g.fillText(s.footer, edge, H - M - 20); }
    pages.push({ jpeg: base64ToBytes(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]), w: W, h: H });
  } while (at < rows.length);
  return pages;
}

// ── 4 · Icons (inline SVG, no files) / Ikoner ────────────────────────────────
const ICONS = {
  contacts: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  check: '<path d="M5 12.5l5 5L19 7"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13 7l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
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
.bd .ib.red{background:#c62828;color:#fff}.bd .ib.green{background:#2e7d32;color:#fff}
.bd .ib.big{width:76px;height:64px}
.bd .ib.grow{width:auto}
.bd select[data-f=cur]{width:auto;min-width:0;display:block;padding:8px 32px 8px 14px;margin:4px 0 10px;font-size:18px;border:0;border-radius:8px;
  background:var(--bd-accent) url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'><path d='M1 1l5 5 5-5' fill='none' stroke='white' stroke-width='2'/></svg>") no-repeat right 10px center;
  color:#fff;-webkit-text-fill-color:#fff}
.bd[dir=rtl] select[data-f=cur]{padding:8px 14px 8px 32px;background-position:left 10px center}
.bd select[data-f=cur] option{color:#111;background:#fff;-webkit-text-fill-color:#111}
.bd .line{display:flex;align-items:center;gap:10px}
.bd .line .info{flex:1;min-width:0}
.bd .line .info b{display:block;font-size:21px;overflow-wrap:anywhere}
.bd .muted{color:#777;font-size:16px}
.bd .owes{color:#c62828}.bd .owe{color:#2e7d32}.bd .set{color:#777}
.bd .bals{text-align:end;font-size:19px;line-height:1.35}
.bd .stats{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.bd .stats div{flex:1;min-width:130px;background:#fff;border-radius:10px;padding:8px;text-align:center;box-shadow:0 1px 3px #0002}
.bd .stats b{display:block;font-size:18px;line-height:1.4}
.bd .stats span{font-size:14px;color:#666}
.bd .acts{display:flex;gap:12px;justify-content:center;margin:10px 0;flex-wrap:wrap}
.bd .head h2{margin:0;font-size:28px}
.bd .entry{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #eee}
.bd .entry .info{flex:1;min-width:0;font-size:17px}
.bd .entry .info b{font-size:20px}
.bd .tag{font-size:14px;color:#777}
.bd .entry.dim{opacity:.55}
.bd .toast{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);background:#222;color:#fff;padding:10px 16px;border-radius:20px;font-size:15px;max-width:90%;z-index:50}
.bd .toast.bad{background:#c62828}
`;

// ── 5 · The screen / Skjermen ────────────────────────────────────────────────
export function mount(el, ctx) {
  const store = ctx.storage;
  const userSettings = store.get('settings', {});
  const S = () => ({ ...DEFAULTS, ...(ctx.options || {}), ...userSettings });
  const t = k => WORDS[S().lang]?.[k] ?? WORDS.en[k];
  let contacts = store.get('contacts', []);     // [{ id, name, phone, note, deleted? }]
  let entries = store.get('entries', []);       // append-only: [{ id, no, contactId, type, amount, currency, note, date, reverses? }]
  let seq = store.get('seq', 0);
  let tab = 'contacts', viewing = null, adding = false, editing = null, entryForm = null, alive = true, confirm = null, search = '';
  let cDraft = { name: '', phone: '', note: '' };
  let eDraft = { amount: '', note: '', cur: null };
  const persist = () => { store.set('contacts', contacts); store.set('entries', entries); store.set('seq', seq); };

  const root = h('div', { class: 'bd' });
  const toast = h('div', { class: 'toast' }); toast.hidden = true;
  let toastTimer = 0;
  function flash(msg, bad = false) {
    toast.textContent = msg; toast.className = 'toast' + (bad ? ' bad' : ''); toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
  }
  const live = () => contacts.filter(c => !c.deleted);
  const find = id => contacts.find(c => c.id === id);

  /** «500 YER owes you» in red, «200 USD you owe» in green, or «Settled». */
  function balanceBlock(bal) {
    const parts = Object.entries(bal).filter(([, v]) => v !== 0);
    if (!parts.length) return h('div', { class: 'bals set' }, t('settled'));
    return h('div', { class: 'bals' }, parts.map(([cur, v]) =>
      h('div', { class: v > 0 ? 'owes' : 'owe' }, `${formatMoney(Math.abs(v), cur)} ${v > 0 ? t('owes') : t('owe')}`)));
  }

  // ── actions ──
  function saveContact() {
    const name = cDraft.name.trim();
    if (!name) return flash(t('nameReq'), true);
    if (editing) { const c = find(editing); if (c) Object.assign(c, { name, phone: cDraft.phone.trim(), note: cDraft.note.trim() }); editing = null; flash(t('saved')); }
    else { contacts.unshift({ id: uid(), name, phone: cDraft.phone.trim(), note: cDraft.note.trim() }); adding = false; flash(t('added')); }
    cDraft = { name: '', phone: '', note: '' }; persist(); render();
  }
  /** Fill the form from ONE contact the person picks. Backing out changes nothing. */
  async function pickFromContacts() {
    try {
      const c = await ctx.pickContact();
      if (!c) return;
      cDraft.name = c.name || cDraft.name; cDraft.phone = c.phone || cDraft.phone;
      render();
    } catch (e) { flash(e.message || t('pick'), true); }
  }
  function recordEntry() {
    const amount = toMinor(eDraft.amount.trim());
    if (amount == null || amount <= 0) return flash(t('amountReq'), true);
    entries.push({ id: uid(), no: ++seq, contactId: viewing, type: entryForm, amount, currency: eDraft.cur || S().currency,
      note: eDraft.note.trim(), date: new Date().toISOString() });
    entryForm = null; eDraft = { amount: '', note: '', cur: eDraft.cur }; persist(); render();
  }
  function reverseEntry(e) {
    const key = `#rev${e.id}`;
    if (confirm !== key) { confirm = key; render(); return; }
    entries.push(reversalOf(e, ++seq, `${t('reversal')} #${e.no}`));       // the original is never touched
    confirm = null; persist(); render();
  }

  // ── output ──
  async function statementHtml(c, list) {
    const s = S(), w = WORDS[s.lang] ?? WORDS.en;
    const font = ctx.fontCss ? await ctx.fontCss().catch(() => '') : '';
    const tables = buildStatement(list).map(sec => `<h3>${esc(sec.cur)}</h3><table><tr><th>${esc(w.dateCol)}</th><th>${esc(w.noteCol)}</th><th>${esc(w.debtCol)}</th><th>${esc(w.payCol)}</th><th>${esc(w.balCol)}</th></tr>` +
      sec.rows.map(r => `<tr><td>${fmtDay(r.date)}</td><td>${esc(r.note || '')}</td><td>${r.type === 'debt' ? esc(formatMoney(r.amount, sec.cur)) : ''}</td><td>${r.type === 'payment' ? esc(formatMoney(r.amount, sec.cur)) : ''}</td><td>${esc(formatMoney(r.balance, sec.cur))}</td></tr>`).join('') +
      `</table><div class="b ${sec.balance > 0 ? 'o' : sec.balance < 0 ? 'w' : ''}">${esc(w.balance)}: ${esc(formatMoney(Math.abs(sec.balance), sec.cur))} ${esc(sec.balance > 0 ? w.owes : sec.balance < 0 ? w.owe : w.settled)}</div>`).join('');
    return `<!doctype html><html lang="${s.lang}" dir="${s.lang === 'ar' ? 'rtl' : 'ltr'}"><meta charset="utf-8"><title>${esc(s.shop || s.title)}</title>
<style>${font}
@page{size:A4;margin:14mm}
body{font-family:'Tajawal',Arial,sans-serif;font-weight:700;margin:0;color:#000}
h1{font-size:24pt;margin:0 0 2mm}h2{font-size:18pt;margin:0 0 2mm;color:${esc(s.accent)}}h3{font-size:15pt;margin:6mm 0 2mm;color:${esc(s.accent)}}.m{font-size:12pt}
table{width:100%;border-collapse:collapse}th{background:#e8f5e9;font-size:11pt;padding:2mm}td{padding:2mm;border-bottom:1px solid #999;font-size:11.5pt;text-align:center}
.b{font-size:15pt;margin-top:3mm}.b.o{color:#c62828}.b.w{color:#2e7d32}.f{margin-top:8mm;font-size:12pt}
</style><h1>${esc(s.shop || s.title)}</h1><h2>${esc(w.statement)}: ${esc(c.name)}</h2>
<div class="m">${esc(c.phone || '')}</div><div class="m">${esc(w.printed)}: ${fmtDay(new Date().toISOString())}</div>${tables || `<p>${esc(w.noEntries)}</p>`}
${s.footer ? `<div class="f">${esc(s.footer)}</div>` : ''}</html>`;
  }
  async function printStatement(c) {
    if (!ctx.print) return flash(t('noPrint'), true);
    try { await ctx.print(await statementHtml(c, entries.filter(e => e.contactId === c.id)), `${t('statement')} ${c.name}`); } catch (e) { flash(e.message || t('noPrint'), true); }
  }
  async function shareStatement(c) {
    if (!ctx.share) return flash(t('noShare'), true);
    try {
      flash(t('makingPdf'));
      const pdf = buildPdf(await renderStatementPages(c, entries.filter(e => e.contactId === c.id), S(), WORDS[S().lang] ?? WORDS.en));
      const slug = c.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'contact';
      await ctx.share(`statement-${slug}-${fmtDay(new Date().toISOString())}.pdf`, bytesToBase64(pdf), 'application/pdf');
    } catch (e) { flash(e.message || t('noShare'), true); }
  }

  // ── views ──
  const curSelect = (value, onchange) => h('select', { 'data-f': 'cur', 'aria-label': t('currency'), onchange: e => onchange(e.target.value) },
    Object.keys(CURRENCIES).map(c => h('option', { value: c, selected: c === value }, c)));

  function contactForm() {
    return h('div', { class: 'card' },
      h('label', {}, t('name')),
      h('div', { class: 'row' },
        h('input', { type: 'text', class: 'grow', 'data-f': 'name', value: cDraft.name, oninput: e => { cDraft.name = e.target.value; } }),
        // Only when the host can pick (Android's picker). A host without it simply shows no button.
        ctx.pickContact && iconBtn('contacts', t('pick'), 'pri', 'pick-contact', pickFromContacts, 28, { style: 'margin-bottom:8px' })),
      h('label', {}, t('phone')), h('input', { type: 'text', inputmode: 'tel', 'data-f': 'phone', value: cDraft.phone, oninput: e => { cDraft.phone = e.target.value; } }),
      h('label', {}, t('note')), h('input', { type: 'text', 'data-f': 'cnote', value: cDraft.note, oninput: e => { cDraft.note = e.target.value; } }),
      h('div', { class: 'row' },
        iconBtn('check', t('save'), 'pri grow', 'save-contact', saveContact, 30),
        iconBtn('x', t('cancel'), 'sec', 'cancel-contact', () => { adding = false; editing = null; cDraft = { name: '', phone: '', note: '' }; render(); })));
  }

  function contactsView() {
    const q = search.trim().toLowerCase();
    const list = live().filter(c => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q));
    const totals = bookTotals(live(), entries);
    return [
      h('div', { class: 'row', style: 'margin-bottom:10px' },
        h('input', { type: 'text', class: 'grow', 'data-f': 'search', placeholder: t('search'), value: search, style: 'margin:0',
          oninput: e => { search = e.target.value; renderList(); } }),
        iconBtn('plus', t('add'), 'pri', 'add-contact', () => { adding = !adding; editing = null; cDraft = { name: '', phone: '', note: '' }; render(); }, 30)),
      adding && contactForm(),
      Object.keys(totals).length ? h('div', { class: 'stats', 'data-totals': '' }, Object.entries(totals).map(([cur, v]) =>
        h('div', {}, h('b', { class: 'owes' }, `${formatMoney(v.toCollect, cur)}`), h('span', {}, `${t('toCollect')}`),
          h('b', { class: 'owe' }, `${formatMoney(v.toPay, cur)}`), h('span', {}, `${t('toPay')}`)))) : null,
      live().length === 0 ? h('p', { class: 'muted' }, t('noContacts')) : null,
      h('div', { 'data-list': '' }, contactRows(list)),
    ];
  }
  function contactRows(list) {
    return list.map(c => h('div', { class: 'card line', 'data-contact': c.id, style: 'cursor:pointer', onclick: () => { viewing = c.id; entryForm = null; confirm = null; render(); } },
      h('div', { class: 'info' }, h('b', {}, c.name), c.phone ? h('span', { class: 'muted' }, c.phone) : null),
      balanceBlock(balanceOf(entries, c.id))));
  }
  function renderList() {                                    // typing in the search box must not rebuild the box itself
    const box = root.querySelector('[data-list]'); if (!box) return;
    const q = search.trim().toLowerCase();
    box.replaceChildren(...contactRows(live().filter(c => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q))));
  }

  function detailView() {
    const c = find(viewing);
    if (!c || c.deleted) { viewing = null; return contactsView(); }
    const mine = entries.filter(e => e.contactId === c.id).sort((a, b) => b.no - a.no);
    const rev = reversedIds(entries);
    const delKey = `#del${c.id}`;
    return [
      h('div', { class: 'card head' },
        h('h2', { 'data-name': '' }, c.name), c.phone ? h('div', { class: 'muted' }, c.phone) : null, c.note ? h('div', { class: 'muted' }, c.note) : null,
        h('div', { 'data-balance': '', style: 'margin-top:8px' }, balanceBlock(balanceOf(entries, c.id)))),
      editing === c.id ? contactForm() : null,
      h('div', { class: 'acts' },
        iconBtn('back', t('back'), 'sec', 'back', () => { viewing = null; entryForm = null; editing = null; confirm = null; render(); }, 28),
        iconBtn('plus', t('debt'), 'red big', 'debt', () => { entryForm = 'debt'; render(); }, 34),
        iconBtn('minus', t('payment'), 'green big', 'payment', () => { entryForm = 'payment'; render(); }, 34),
        iconBtn('print', t('print'), 'pri', 'print', () => printStatement(c), 28),
        iconBtn('share', t('share'), 'pri', 'share', () => shareStatement(c), 28),
        iconBtn('edit', t('edit'), 'sec', 'edit-contact', () => { editing = c.id; cDraft = { name: c.name, phone: c.phone || '', note: c.note || '' }; render(); }, 26),
        iconBtn(confirm === delKey ? 'check' : 'trash', confirm === delKey ? t('sure') : t('del'), confirm === delKey ? 'dng solid' : 'dng', 'del-contact', () => {
          if (confirm !== delKey) { confirm = delKey; render(); return; }
          c.deleted = true; viewing = null; confirm = null; persist(); render();           // soft delete: history is kept
        }, 26)),
      entryForm && h('div', { class: 'card' },
        h('h2', { class: entryForm === 'debt' ? 'owes' : 'owe', style: 'margin:0 0 6px;font-size:26px' }, entryForm === 'debt' ? t('debt') : t('payment')),
        h('label', {}, t('amount')),
        h('input', { type: 'text', inputmode: 'decimal', 'data-f': 'amount', value: eDraft.amount, oninput: e => { eDraft.amount = e.target.value; } }),
        curSelect(eDraft.cur || S().currency, v => { eDraft.cur = v; }),
        h('label', {}, t('note')),
        h('input', { type: 'text', 'data-f': 'note', value: eDraft.note, oninput: e => { eDraft.note = e.target.value; } }),
        h('div', { class: 'row' },
          iconBtn('check', t('confirmEntry'), 'pri grow', 'record', recordEntry, 30),
          iconBtn('x', t('cancel'), 'sec', 'cancel-entry', () => { entryForm = null; render(); }))),
      mine.length === 0 ? h('p', { class: 'muted' }, t('noEntries')) : h('div', { class: 'card' }, mine.map(e => {
        const isReversal = !!e.reverses, isReversed = rev.has(e.id), rkey = `#rev${e.id}`;
        return h('div', { class: 'entry' + (isReversed || isReversal ? ' dim' : ''), 'data-entry': String(e.no) },
          h('div', { class: 'info' },
            h('b', { class: e.type === 'debt' ? 'owes' : 'owe' }, `${e.type === 'debt' ? '+' : '−'} ${formatMoney(e.amount, e.currency)}`),
            h('div', {}, `${e.type === 'debt' ? t('debt') : t('payment')} · #${e.no} · ${fmtDate(e.date)}`),
            e.note ? h('div', { class: 'muted' }, e.note) : null,
            isReversed ? h('div', { class: 'tag' }, t('reversed')) : null),
          !isReversal && !isReversed && iconBtn(confirm === rkey ? 'check' : 'undo', confirm === rkey ? t('sure') : t('reverse'), confirm === rkey ? 'dng solid' : 'sec', 'reverse', () => reverseEntry(e), 24));
      })),
    ];
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
    const inDetail = tab === 'contacts' && viewing;
    const view = inDetail ? detailView() : tab === 'contacts' ? contactsView() : settingsView();
    root.replaceChildren(
      h('h1', {}, s.title),
      !viewing && h('div', { class: 'tabs' }, [['contacts', t('contacts')], ['settings', t('settings')]].map(([id, label]) =>
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
  host.screen?.({ id: 'desk', title: DEFAULTS.title, icon: '📒', mount });
}
