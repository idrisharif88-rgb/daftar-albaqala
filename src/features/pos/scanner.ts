import { Capacitor } from '@capacitor/core';
import { expectReturn } from '../../lib/biometric';

// The camera scan, through Google's own code scanner (ML Kit). It runs as a
// separate screen of Google Play services, so this app holds NO camera
// permission and shows no permission dialog — the same delegation as the
// contacts picker. Android only; a browser has no such scanner, and the sell
// screen offers a typed-code box there instead.

export function cameraScanAvailable(): boolean {
  return Capacitor.getPlatform() === 'android';
}

/** Scan one barcode. Resolves to its digits, or null if the person backed out.
 *  Throws an Arabic message when the scanner itself cannot run. */
export async function scanOne(): Promise<string | null> {
  expectReturn(); // the lock must not greet the seller on the way back
  try {
    const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');
    const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
    if (!available) {
      // First use on this phone: Google downloads the scanner once.
      await BarcodeScanner.installGoogleBarcodeScannerModule();
      throw new Error('يجري تجهيز الماسح لأول مرة. حاول مرة أخرى بعد لحظات.');
    }
    const { barcodes } = await BarcodeScanner.scan({
      formats: [BarcodeFormat.Ean13],
      autoZoom: true,
    });
    return barcodes[0]?.rawValue ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/cancel/i.test(msg)) return null; // backing out is not an error
    if (/[؀-ۿ]/.test(msg)) throw err; // already Arabic
    throw new Error('تعذّر تشغيل الماسح. تأكد من خدمات Google Play ثم أعد المحاولة.');
  }
}
