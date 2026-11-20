// A shop's own logo, set by the developer (Watcher) and shown on that shop's
// Home. Kept as a data URL: the Watcher shrinks it to ≤ 256 px before sending,
// so it is a few tens of KB — small enough for one column, and it avoids a
// file store on a 1 GB droplet.

/** ~300 KB of base64 ≈ 220 KB of image: far above a 256 px JPEG, well below abuse. */
export const MAX_LOGO_LENGTH = 300_000;

const DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** A valid logo data URL, or null when it is not one (or too large). */
export function validLogo(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_LOGO_LENGTH) return null;
  return DATA_URL.test(value) ? value : null;
}
