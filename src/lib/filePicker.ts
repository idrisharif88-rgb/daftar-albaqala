import { Capacitor, registerPlugin } from '@capacitor/core';
import { expectReturn } from './biometric';

// Pick ONE file (an image or a PDF) to attach to an entry — with NO storage or
// media permission at all.
//
// On Android this calls `FilePickerPlugin.java`, which fires ACTION_GET_CONTENT.
// The system picker shows the user their files; they choose one, and Android
// hands back that single file through a one-shot read grant. The app never asks
// to read "photos and media" or external storage — the same least-privilege
// move as the contact picker (contacts.ts): you are handed the one row you need
// instead of a key to the whole drawer.
//
// On the web (the dev loop) there is no native picker, so a hidden <input
// type=file> is used instead, which is exactly the browser's own file dialog.

export interface PickedFile {
  /** base64, no data: prefix. */
  data: string;
  mime: string;
  filename: string;
  size: number; // bytes
}

// Keep large files out of memory: a picked PDF above this is refused before it
// crosses the bridge. Images are compressed afterwards, so their original size
// is bounded here too.
const MAX_BYTES = 12 * 1024 * 1024;

interface FilePickerPlugin {
  pick(): Promise<{
    data?: string; mime?: string; filename?: string; size?: number;
    cancelled?: boolean; tooLarge?: boolean;
  }>;
}

const FilePicker = registerPlugin<FilePickerPlugin>('FilePicker');

export class FileTooLargeError extends Error {
  constructor() {
    super('الملف كبير جداً');
    this.name = 'FileTooLargeError';
  }
}

export async function pickFile(): Promise<PickedFile | null> {
  expectReturn(); // the lock must not greet the owner on the way back
  if (Capacitor.getPlatform() === 'web') return pickFileWeb();

  try {
    const r = await FilePicker.pick();
    if (r.tooLarge) throw new FileTooLargeError();
    if (r.cancelled || !r.data || !r.mime) return null;
    return {
      data: r.data,
      mime: r.mime,
      filename: (r.filename ?? '').trim() || 'ملف',
      size: r.size ?? Math.floor((r.data.length * 3) / 4),
    };
  } catch (err) {
    if (err instanceof FileTooLargeError) throw err;
    console.warn('file picker unavailable', err);
    return null;
  }
}

// Web: the browser's own file dialog. Resolves null if the user cancels — which
// browsers don't report directly, so there is no cancel branch, only "no file".
function pickFileWeb(): Promise<PickedFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      if (file.size > MAX_BYTES) { reject(new FileTooLargeError()); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('failed to read file'));
      reader.onload = () => {
        const data = String(reader.result).split(',')[1] ?? '';
        resolve({ data, mime: file.type || 'application/octet-stream', filename: file.name, size: file.size });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  });
}
