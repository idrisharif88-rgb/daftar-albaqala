/**
 * PLUGIN · barcode-ean13  (zero dependencies, fully offline / null avhengigheter, helt offline)
 * EN: A plugin = a manifest (plugin.json) + a module that exports register(host).
 *     It never touches the host's internals; it only PROVIDES named commands.
 * NO: En plugin = et manifest (plugin.json) + en modul som eksporterer register(host).
 *     Den rører aldri vertens indre; den LEVERER bare navngitte kommandoer.
 * Origin / Opphav: daftar-albaqala/src/lib/productCodes.ts (+ SVG drawing / + SVG-tegning)
 */

// ── 1 · Check digit / Kontrollsiffer ────────────────────────────────────────
export function checkDigit(body12) {
  body12 = String(body12);
  if (!/^\d{12}$/.test(body12)) throw new Error('body12 must be 12 digits');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

// ── 2 · Generate unique codes / Lag unike koder ─────────────────────────────
// prefix «2» = GS1 in-store range; bytes ≥ 250 rejected = unbiased digits.
function randomCode(prefix) {
  const bytes = new Uint8Array(12);
  let body = prefix;
  while (body.length < 12) {
    crypto.getRandomValues(bytes);
    for (const b of bytes) if (b < 250 && body.length < 12) body += String(b % 10);
  }
  return body + checkDigit(body);
}
export function generate(count = 1, existing = [], prefix = '2') {
  if (!/^\d{1,11}$/.test(prefix)) throw new Error('prefix must be 1–11 digits');
  const taken = new Set(existing), made = [];
  while (made.length < count) {
    const code = randomCode(prefix);
    if (!taken.has(code)) { taken.add(code); made.push(code); }
  }
  return made;
}

// ── 3 · Validate a scan / Valider en skanning ───────────────────────────────
// Returns the clean code, or null. `anyPrefix` accepts factory codes too.
export function validate(raw, anyPrefix = false) {
  const s = String(raw).trim();
  if (!/^\d{13}$/.test(s)) return null;
  if (!anyPrefix && s[0] !== '2') return null;
  return checkDigit(s.slice(0, 12)) === Number(s[12]) ? s : null;
}

// ── 4 · Draw as SVG / Tegn som SVG ──────────────────────────────────────────
// 95 modules: guard(3) + 6 digits(42) + middle(5) + 6 digits(42) + guard(3).
const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const R = L.map(p => [...p].map(b => (b === '0' ? '1' : '0')).join(''));
const PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];

export function toModules(code) {
  code = String(code);
  if (!validate(code, true)) throw new Error('invalid EAN-13');
  const parity = PARITY[Number(code[0])];
  let bits = '101';
  for (let i = 0; i < 6; i++) bits += (parity[i] === 'L' ? L : G)[Number(code[i + 1])];
  bits += '01010';
  for (let i = 7; i < 13; i++) bits += R[Number(code[i])];
  return bits + '101';
}
export function svg(code, { module: m = 2, height = 80, margin = 10 } = {}) {
  code = String(code);
  const bits = toModules(code);
  const w = (bits.length + margin * 2) * m, h = height + 22;
  let bars = '';
  for (let i = 0; i < bits.length; ) {                // merge neighbouring black modules
    if (bits[i] === '0') { i++; continue; }
    let j = i; while (bits[j] === '1') j++;
    bars += `<rect x="${(margin + i) * m}" y="0" width="${(j - i) * m}" height="${height}"/>`;
    i = j;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="100%" height="100%" fill="#fff"/><g fill="#000">${bars}</g>` +
    `<text x="${w / 2}" y="${height + 17}" font-family="monospace" font-size="16" text-anchor="middle">${code}</text></svg>`;
}

// ── 5 · The ONLY door into the host / Den ENESTE døren inn til verten ────────
export function register(host) {
  host.provide('barcode.generate', generate);
  host.provide('barcode.validate', validate);
  host.provide('barcode.checkDigit', checkDigit);
  host.provide('barcode.svg', svg);
}
