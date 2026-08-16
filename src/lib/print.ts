import { getMeta, setMeta } from '../data/meta';
import { renderReceipt, canvasToEscPos, type ReceiptOptions } from './receipt';

// Sending a receipt to a Bluetooth thermal printer.
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

/** True when this build can actually print (an Android build with the plugin). */
export function printingAvailable(): boolean {
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

export async function savePrinter(address: string): Promise<void> {
  await setMeta(PRINTER_KEY, address);
}

export async function forgetPrinter(): Promise<void> {
  await setMeta(PRINTER_KEY, '');
}

/**
 * Render the receipt and send it to the saved printer.
 *
 * Throws with an Arabic message the caller can show. The caller must have
 * already SAVED the entry: printing is the last step and the least reliable
 * one, and a failure here must never be a reason to lose the debt.
 */
export async function printReceipt(o: ReceiptOptions): Promise<void> {
  const bt = plugin();
  if (!bt) throw new Error('الطباعة متاحة على الهاتف فقط.');

  const address = await getSavedPrinter();
  if (!address) throw new Error('لم تُحدَّد طابعة. اخترها من الإعدادات.');

  const canvas = await renderReceipt(o);
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
