import { getMeta, setMeta } from '../data/meta';
import { renderReceipt, canvasToEscPos, PAPER_DOTS, type ReceiptOptions } from './receipt';
import { printPdf, systemPrintAvailable } from './systemPrint';

// Printing a receipt — two ways, because no single one reaches every printer.
//
//   'thermal' — ESC/POS straight to the Bluetooth receipt printer chosen in
//               Settings. No dialog, one tap, the receipt strip as drawn.
//   'system'  — the same receipt laid on an A4 page and handed to Android's
//               print dialog (systemPrint.ts), which reaches whatever printer
//               the phone can: an office laser on the WiFi, a print-service
//               printer, «Save as PDF». A Bluetooth thermal printer usually does
//               NOT appear there unless its maker's app is installed — which is
//               why the direct path stays.
//
// Both print the SAME bitmap from receipt.ts, so the paper reads the same
// whichever printer it came out of.

export type PrintTarget = 'thermal' | 'system';

// ---- Direct Bluetooth thermal printing ----
//
// The transport is Bluetooth CLASSIC (SPP), not BLE. Nearly every cheap 58/80mm
// receipt printer speaks the old serial profile; the BLE plugins in the
// Capacitor ecosystem cannot talk to them at all, which is the single most
// common way this integration is built wrong. `cordova-plugin-bluetooth-serial`
// gives us the paired-device list, a socket, and raw writes — which is all an
// ESC/POS printer needs.
//
// The printer is chosen ONCE and remembered: the owner prints from the same
// counter every day, and a device picker on every receipt would be a tax on the
// commonest action. `forgetPrinter` is there for when the printer changes.
//
// Web is a no-op path — there is no Bluetooth serial in a browser — so the
// dev loop keeps working and only the device build actually prints.

const PRINTER_KEY = 'printer_mac';
const PRINTER_NAME_KEY = 'printer_name';
// Which kind of printer the owner chose in Settings. Per-device, like the
// printer itself — the printer is on THIS counter — so it is not in the synced
// settings allowlist.
const PRINT_MODE_KEY = 'print_mode';

/** A paired Bluetooth device as the plugin reports it. */
export interface PrinterDevice {
  address: string;
  name?: string;
  id?: string;
  class?: number;
}

// The plugin attaches itself to `window` with callback-style methods.
interface BluetoothSerial {
  list(ok: (devices: PrinterDevice[]) => void, fail: (e: unknown) => void): void;
  isEnabled(ok: () => void, fail: (e: unknown) => void): void;
  connect(address: string, ok: () => void, fail: (e: unknown) => void): void;
  disconnect(ok: () => void, fail: (e: unknown) => void): void;
  write(data: ArrayBuffer | Uint8Array, ok: () => void, fail: (e: unknown) => void): void;
}

function plugin(): BluetoothSerial | null {
  return (window as unknown as { bluetoothSerial?: BluetoothSerial }).bluetoothSerial ?? null;
}

/** True when this build can drive a Bluetooth thermal printer directly. */
export function thermalPrintingAvailable(): boolean {
  return plugin() !== null;
}

// The plugin predates promises; every call is (success, failure). Wrapping each
// one keeps the flow below readable as ordinary async code.
function promisify<T>(
  call: (ok: (value: T) => void, fail: (e: unknown) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    call(resolve, (e) => reject(new Error(typeof e === 'string' ? e : 'فشل الاتصال بالطابعة')));
  });
}

export async function listPrinters(): Promise<PrinterDevice[]> {
  const bt = plugin();
  if (!bt) return [];
  await promisify<void>((ok, fail) => bt.isEnabled(() => ok(undefined), fail))
    .catch(() => { throw new Error('البلوتوث مغلق. شغّله ثم أعد المحاولة.'); });
  // Paired devices only. An ESC/POS printer must be paired in Android settings
  // first (it asks for a PIN, usually 0000 or 1234) — discovery here would list
  // every phone in the room and still fail to bond.
  return promisify<PrinterDevice[]>((ok, fail) => bt.list(ok, fail));
}

export async function getSavedPrinter(): Promise<string | null> {
  return getMeta(PRINTER_KEY);
}

/** The saved thermal printer's display name, when the device reported one. */
export async function getSavedPrinterName(): Promise<string | null> {
  return getMeta(PRINTER_NAME_KEY);
}

export async function savePrinter(address: string, name?: string): Promise<void> {
  await setMeta(PRINTER_KEY, address);
  await setMeta(PRINTER_NAME_KEY, name ?? '');
}

export async function forgetPrinter(): Promise<void> {
  await setMeta(PRINTER_KEY, '');
  await setMeta(PRINTER_NAME_KEY, '');
}

/**
 * The printer kind chosen in Settings. Before anything was chosen: a phone that
 * already has a thermal printer saved keeps using it (that is what it did
 * before this setting existed); otherwise Android's print dialog, which needs
 * no setup at all.
 */
export async function getPrintMode(): Promise<PrintTarget> {
  const mode = await getMeta(PRINT_MODE_KEY);
  if (mode === 'thermal' || mode === 'system') return mode;
  return (await getSavedPrinter()) ? 'thermal' : 'system';
}

export async function setPrintMode(mode: PrintTarget): Promise<void> {
  await setMeta(PRINT_MODE_KEY, mode);
}

/**
 * The target to print to right now, or an Arabic reason why there is none.
 * Checked BEFORE an invoice is recorded, so a printer that is not set up stops
 * the act instead of leaving a recorded debt with no receipt.
 */
export async function readyPrintTarget(): Promise<PrintTarget> {
  const mode = await getPrintMode();
  if (mode === 'thermal') {
    if (!thermalPrintingAvailable()) throw new Error('الطباعة متاحة على الهاتف فقط.');
    if (!(await getSavedPrinter())) {
      throw new Error('لم تُحدَّد الطابعة الحرارية. اخترها من الإعدادات.');
    }
    return 'thermal';
  }
  if (!systemPrintAvailable()) throw new Error('الطباعة متاحة على الهاتف فقط.');
  return 'system';
}

/**
 * Render the receipt and print it the chosen way.
 *
 * Throws with an Arabic message the caller can show. The caller must have
 * already SAVED the entry: printing is the last step and the least reliable
 * one, and a failure here must never be a reason to lose the debt.
 */
export async function printReceipt(o: ReceiptOptions, target: PrintTarget): Promise<void> {
  const canvas = await renderReceipt(o);
  if (target === 'system') {
    await printPdf(await receiptPdfBase64(canvas), `فاتورة-${o.number}`);
    return;
  }
  await printThermal(canvas);
}

async function printThermal(canvas: HTMLCanvasElement): Promise<void> {
  const bt = plugin();
  if (!bt) throw new Error('الطباعة متاحة على الهاتف فقط.');

  const address = await getSavedPrinter();
  if (!address) throw new Error('لم تُحدَّد طابعة. اخترها من الإعدادات.');

  const bytes = canvasToEscPos(canvas);

  await promisify<void>((ok, fail) => bt.connect(address, () => ok(undefined), fail));
  try {
    // One write of the whole strip. The plugin buffers it and the printer
    // consumes it at its own pace; the raster is already split into bands that
    // fit the printer's input buffer (see receipt.ts).
    await promisify<void>((ok, fail) => bt.write(bytes, () => ok(undefined), fail));
    // The socket must stay open long enough for the printer to drain what it
    // has been handed. Disconnecting the instant `write` returns cuts a long
    // receipt off mid-page — `write` reports "handed to the OS", not "printed".
    await new Promise((r) => setTimeout(r, 1200));
  } finally {
    // Always release the socket: these printers accept exactly one connection,
    // and a leaked one makes the NEXT print fail for no visible reason.
    await promisify<void>((ok, fail) => bt.disconnect(() => ok(undefined), fail))
      .catch(() => undefined);
  }
}

// ---- The receipt on A4, for the system print dialog ----
//
// The strip keeps its REAL receipt size — 72mm, the printable width of 80mm
// thermal paper — whatever paper it lands on. The owner's call: on an A4 laser
// it comes out exactly as the thermal printer would print it, and he cuts it
// out with scissors. Stretched to the page, a five-line receipt would become a
// poster. A long receipt continues onto further pages.

const A4_W = 210;
const A4_H = 297;
const STRIP_W_MM = 72;
const PAGE_MARGIN_MM = 10;
const PX_PER_MM = PAPER_DOTS / STRIP_W_MM;

async function receiptPdfBase64(canvas: HTMLCanvasElement): Promise<string> {
  // Loaded on demand: Settings imports this module for the printer picker, and
  // jspdf would otherwise ride along into the startup bundle.
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF('p', 'mm', 'a4');

  const pageRowsPx = Math.floor((A4_H - PAGE_MARGIN_MM * 2) * PX_PER_MM);
  const x = (A4_W - STRIP_W_MM) / 2;

  const slices = sliceAtBlankRows(canvas, pageRowsPx);
  slices.forEach(([from, to], i) => {
    const part = document.createElement('canvas');
    part.width = canvas.width;
    part.height = to - from;
    const ctx = part.getContext('2d');
    if (!ctx) throw new Error('تعذّر تجهيز الفاتورة');
    ctx.drawImage(canvas, 0, from, canvas.width, to - from, 0, 0, canvas.width, to - from);
    if (i > 0) pdf.addPage();
    // PNG: the receipt is black on white, which PNG keeps sharp and small,
    // where JPEG would smear the edges of every letter.
    pdf.addImage(part.toDataURL('image/png'), 'PNG', x, PAGE_MARGIN_MM,
      STRIP_W_MM, (to - from) / PX_PER_MM);
  });

  return pdf.output('datauristring').split(',')[1];
}

/**
 * Split a tall strip into page-sized pieces, each cut on a row that is entirely
 * white — between two lines of text, never through one. If no blank row turns
 * up close enough to the page end, it cuts at the page end anyway: a sliced
 * line is better than a page that runs off the paper.
 */
function sliceAtBlankRows(canvas: HTMLCanvasElement, maxRows: number): [number, number][] {
  const h = canvas.height;
  if (h <= maxRows) return [[0, h]];

  const ctx = canvas.getContext('2d');
  const pixels = ctx?.getImageData(0, 0, canvas.width, h).data;
  const blank = (y: number): boolean => {
    if (!pixels) return true;
    const rowStart = y * canvas.width * 4;
    for (let i = rowStart; i < rowStart + canvas.width * 4; i += 4) {
      if (pixels[i] < 240 || pixels[i + 1] < 240 || pixels[i + 2] < 240) return false;
    }
    return true;
  };

  const slices: [number, number][] = [];
  let from = 0;
  while (h - from > maxRows) {
    let cut = from + maxRows;
    // Look back at most a fifth of a page for a gap between lines.
    const floor = cut - Math.floor(maxRows / 5);
    while (cut > floor && !blank(cut)) cut--;
    if (cut <= floor) cut = from + maxRows;
    slices.push([from, cut]);
    from = cut;
  }
  slices.push([from, h]);
  return slices;
}
