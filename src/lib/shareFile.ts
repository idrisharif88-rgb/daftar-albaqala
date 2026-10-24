import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { classifyShareError } from './shareTarget';
import { expectReturn } from './biometric';

// Share one attached file, WhatsApp first.
//
// Same mechanism the PDF statement uses (pdf.ts): hand the file to WhatsApp
// with the bytes ATTACHED, and let the grocer pick the chat. WhatsApp's public
// API cannot both pre-select a contact AND carry a file, so the file is what we
// guarantee and the chat is one tap. If WhatsApp isn't installed we fall back
// to the system share sheet, so the file can still go out some other way.
//
// On the web (dev loop) there is no share target, so the file downloads.

declare global {
  interface Window {
    plugins?: {
      socialsharing?: {
        // fileOrFileArray accepts a local path, an http(s) URL, or a
        // "df:<name>;data:<mime>;base64,<data>" string (used here).
        shareViaWhatsApp: (
          message: string | null,
          fileOrFileArray: string | string[] | null,
          url: string | null,
          onSuccess?: () => void,
          onError?: (err: string) => void,
        ) => void;
      };
    };
  }
}

export interface ShareableFile {
  /** base64, no data: prefix. */
  data: string;
  mime: string;
  filename: string;
  /** Message that rides with the file (e.g. the store / owner name). */
  caption?: string;
}

export async function shareFileViaWhatsApp(file: ShareableFile): Promise<void> {
  expectReturn(); // the lock must not greet the owner on the way back
  const name = file.filename || 'file';

  if (Capacitor.getPlatform() === 'web') {
    const a = document.createElement('a');
    a.href = `data:${file.mime};base64,${file.data}`;
    a.download = name;
    a.click();
    return;
  }

  // WhatsApp with the file attached.
  const fileArg = `df:${name};data:${file.mime};base64,${file.data}`;
  const sos = window.plugins?.socialsharing;
  if (sos?.shareViaWhatsApp) {
    try {
      await new Promise<void>((resolve, reject) => {
        sos.shareViaWhatsApp(
          file.caption ?? null,
          fileArg,
          null,
          () => resolve(),
          (err) => reject(new Error(err || 'whatsapp share failed')),
        );
      });
      return;
    } catch {
      // WhatsApp missing / the user backed out — fall through to the system
      // sheet so the file can still be shared another way.
    }
  }

  // Fallback: write to cache and open the system share sheet.
  const written = await Filesystem.writeFile({
    path: name, data: file.data, directory: Directory.Cache,
  });
  try {
    await Share.share({ title: file.caption || name, url: written.uri });
  } catch (err) {
    // A real failure (no target) is reported; a cancellation is not — the
    // caller checks the type (shareTarget.ts).
    throw classifyShareError(err);
  }
}
