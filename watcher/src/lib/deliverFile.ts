import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

// Getting a finished file out of the Watcher, the same way for both exporters.
//
// In the laptop browser that is an ordinary download. On the phone there is no
// download folder to speak of, so the file is written to the app's cache and
// handed to the system share sheet — WhatsApp, Drive, email, the owner picks.
// Cache, not Documents: the file has left the app the moment it is shared, and
// Android is free to reclaim the copy.

/** `/ \ : * ? " < > |` are illegal in a filename; Arabic itself is fine. */
export function safeName(value: string, max = 40): string {
  return value.replace(/[/\\:*?"<>|]/g, '').trim().replace(/\s+/g, '_').slice(0, max);
}

/** Today as `2026-10-24` — a date, not a timestamp: two copies of the same book
 *  on the same day are the same document, and a counter only makes the name
 *  harder to read. */
export function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function deliverFile(
  data: Blob | string, filename: string, title: string,
): Promise<void> {
  if (Capacitor.getPlatform() === 'web') {
    const blob = typeof data === 'string' ? base64ToBlob(data) : data;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const written = await Filesystem.writeFile({
    path: filename,
    data: typeof data === 'string' ? data : await blobToBase64(data),
    directory: Directory.Cache,
  });
  try {
    await Share.share({ title, url: written.uri });
  } catch {
    // The file exists; what failed is finding something to open it with — or
    // the owner simply backed out of the sheet, which is not worth shouting
    // about either way.
    throw new Error('تعذّر إرسال الملف. تأكد من وجود تطبيق يفتحه.');
  }
}

// FileReader gives a data: URL; the plugin wants the payload without the prefix.
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('failed to read file'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string): Blob {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: 'application/pdf' });
}
