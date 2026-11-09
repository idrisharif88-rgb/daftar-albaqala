// What THIS app (the host) gives to plugin screens: storage, the camera scanner,
// the system print dialog and the bundled Tajawal font. A plugin asks for them;
// it never imports Capacitor itself, which is why it can run in any host.
// Hva DENNE appen (verten) gir til pluginskjermer: lager, kameraskanner,
// systemets utskriftsdialog og den medfølgende Tajawal-fonten. En plugin ber om
// dem; den importerer aldri Capacitor selv, og derfor kan den kjøre i enhver vert.
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Capabilities, PluginStorage } from './pluginHost';
import { shareBase64File } from './files';

// ── storage: one namespace per plugin / ett navnerom per plugin ──────────────
function storage(pluginId: string): PluginStorage {
  const k = (key: string) => `plugin-lab.data.${pluginId}.${key}`;
  return {
    get<T>(key: string, fallback: T): T {
      try { const raw = localStorage.getItem(k(key)); return raw == null ? fallback : (JSON.parse(raw) as T); }
      catch { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(k(key), JSON.stringify(value)); } catch { /* full or blocked */ } },
    remove(key) { try { localStorage.removeItem(k(key)); } catch { /* ignore */ } },
  };
}

// ── scan: Google's code scanner (ML Kit) — a separate system screen, so the app
//    holds NO camera permission. / et eget systemvindu, så appen trenger INGEN kameratillatelse.
const onAndroid = Capacitor.getPlatform() === 'android';

async function scan(): Promise<string | null> {
  try {
    const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');
    const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
    if (!available) {
      // First use on this phone: Google downloads the scanner module once.
      await BarcodeScanner.installGoogleBarcodeScannerModule();
      throw new Error('The scanner is being prepared for the first time. Try again in a moment.');
    }
    const { barcodes } = await BarcodeScanner.scan({ autoZoom: true });
    return barcodes[0]?.rawValue ?? null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/cancel/i.test(msg)) return null;          // backing out is not an error
    if (/prepared/.test(msg)) throw e;
    throw new Error('The scanner could not start. Check Google Play services.');
  }
}

// ── print: native dialog on the phone, the browser's own in a browser ────────
const HostPrint = registerPlugin<{ printHtml(o: { html: string; jobName: string }): Promise<void> }>('HostPrint');

async function print(html: string, jobName: string): Promise<void> {
  if (Capacitor.isNativePlatform()) return HostPrint.printHtml({ html, jobName });
  const w = window.open('', '_blank');
  if (!w) throw new Error('Allow pop-ups to print.');
  w.document.write(html); w.document.close(); w.focus(); w.print();
}

// ── pickContact: Android's own contact picker — one row, NO contacts permission ──
const ContactPicker = registerPlugin<{ pick(): Promise<{ name?: string; phone?: string; cancelled?: boolean }> }>('ContactPicker');

async function pickContact(): Promise<{ name: string; phone: string } | null> {
  try {
    const r = await ContactPicker.pick();
    if (r.cancelled) return null;                       // backing out is not an error
    // Spaces and dashes out, so «0770 123-456» is stored as «0770123456».
    return { name: (r.name ?? '').trim(), phone: (r.phone ?? '').replace(/[\s-]+/g, '') };
  } catch { return null; }                              // no contacts app: the form still works by hand
}

// ── font: Tajawal Bold as inline data, so a printed page needs no files ───────
let fontCache: Promise<string> | null = null;
const RANGES = {
  arabic: 'U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF, U+200C-200E',
  latin: 'U+0000-00FF, U+2000-206F, U+20AC, U+2122, U+2212',
} as const;

async function toBase64(url: string): Promise<string> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fontCss(): Promise<string> {
  return (fontCache ??= (async () => {
    try {
      const faces = await Promise.all((Object.keys(RANGES) as (keyof typeof RANGES)[]).map(async s =>
        `@font-face{font-family:'Tajawal';font-weight:700;src:url(data:font/woff2;base64,${await toBase64(`/fonts/tajawal-${s}-700.woff2`)}) format('woff2');unicode-range:${RANGES[s]}}`));
      return faces.join('');
    } catch { return ''; }                          // no font → the page falls back to a system face
  })());
}

export const capabilities: Capabilities = {
  storage,
  scan: onAndroid ? scan : undefined,               // a browser has no such scanner
  pickContact: onAndroid ? pickContact : undefined,
  print,
  // Backing out of the share sheet is not an error. / Å avbryte delingsarket er ikke en feil.
  share: async (filename, base64, mime) => {
    try { await shareBase64File(filename, base64, mime); }
    catch (e) { if (!/cancel/i.test((e as Error).message)) throw e; }
  },
  fontCss,
};
