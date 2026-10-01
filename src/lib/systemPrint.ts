import { Capacitor, registerPlugin } from '@capacitor/core';

// Printing through Android's own print dialog — any printer the phone can
// reach: an office laser on the WiFi, a printer shared by a print service app,
// a thermal unit whose maker ships one, or «Save as PDF».
//
// The app hands over a finished PDF and the system does the rest
// (`SystemPrintPlugin.java`): the user picks the printer, the copies and the
// paper there. No permission is involved.
//
// Android only. A browser has no such dialog the app can feed a PDF into, and
// the dev loop has no printer anyway.

interface SystemPrintPlugin {
  printPdf(options: { base64: string; jobName: string }): Promise<void>;
}

const SystemPrint = registerPlugin<SystemPrintPlugin>('SystemPrint');

export function systemPrintAvailable(): boolean {
  return Capacitor.getPlatform() === 'android';
}

/**
 * Open the print dialog on a PDF (base64, no `data:` prefix).
 *
 * Resolves once the dialog is SHOWN. Whether paper came out is between the
 * print service and the printer — Android does not tell the app, and nothing
 * here claims otherwise. Throws with an Arabic message the caller can show.
 */
export async function printPdf(base64: string, jobName: string): Promise<void> {
  if (!systemPrintAvailable()) throw new Error('الطباعة متاحة على الهاتف فقط.');
  try {
    await SystemPrint.printPdf({ base64, jobName });
  } catch (err) {
    // The plugin's own messages are already Arabic.
    throw new Error(err instanceof Error && err.message ? err.message : 'تعذّر فتح نافذة الطباعة');
  }
}
