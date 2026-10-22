// Shrink a photo before it is stored and uploaded.
//
// A phone camera produces 3–8 MB images; a receipt or a product photo needs
// none of that resolution to be readable, and every byte is one the owner's
// droplet has to store and one his correspondent has to download. So raster
// images are redrawn at a sane maximum dimension and re-encoded as JPEG. The
// work is done on a canvas in the WebView — the same tool the PDF and the
// receipt use, and the only image pipeline available offline.
//
// PDFs and GIFs pass through untouched: a PDF is not a raster, and redrawing a
// GIF on a canvas would freeze it to its first frame.

const MAX_DIM = 1600; // longest edge, px
const JPEG_QUALITY = 0.82;

const RASTER = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface CompressedFile {
  /** base64, no data: prefix. */
  data: string;
  mime: string;
  size: number; // bytes, approximate
}

function base64Bytes(b64: string): number {
  // Every 4 base64 chars encode 3 bytes, minus any '=' padding.
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/**
 * Compress a raster image; return others unchanged. Input and output `data` are
 * base64 with no prefix. Never throws — if anything about the canvas path fails
 * (an exotic format, a WebView quirk), the original is returned so the file is
 * still attached, just not shrunk.
 */
export async function compressImage(data: string, mime: string): Promise<CompressedFile> {
  if (!RASTER.has(mime)) return { data, mime, size: base64Bytes(data) };

  try {
    const img = await loadImage(`data:${mime};base64,${data}`);
    const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { data, mime, size: base64Bytes(data) };
    // White behind a transparent PNG — a JPEG has no alpha, and black is the
    // ugly default for a scanned receipt.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const out = canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1] ?? '';
    canvas.width = 0;
    canvas.height = 0;
    if (!out) return { data, mime, size: base64Bytes(data) };
    // If re-encoding somehow made it bigger (a tiny image), keep the original.
    if (base64Bytes(out) >= base64Bytes(data)) return { data, mime, size: base64Bytes(data) };
    return { data: out, mime: 'image/jpeg', size: base64Bytes(out) };
  } catch {
    return { data, mime, size: base64Bytes(data) };
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
}
