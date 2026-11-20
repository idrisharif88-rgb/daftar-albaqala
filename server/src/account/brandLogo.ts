// A shop's own pictures, set by the developer (Watcher):
//   logo  — small, the badge beside the greeting on Home (024)
//   intro — bigger (the shop's whole card), played full-screen once after
//           sign-in (025)
// Kept as data URLs: the Watcher shrinks them first (≤256 / ≤720 px), so each
// is tens of KB — small enough for a column, and no file store on a 1 GB droplet.

export type BrandKind = 'logo' | 'intro';

export const BRAND_COLUMNS: Record<BrandKind, { data: string; at: string; max: number }> = {
  logo: { data: 'brand_logo', at: 'brand_logo_at', max: 300_000 },
  intro: { data: 'brand_intro', at: 'brand_intro_at', max: 800_000 },
};

export function brandKind(value: unknown): BrandKind | null {
  if (value === undefined || value === 'logo') return 'logo';
  return value === 'intro' ? 'intro' : null;
}

const DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** A valid image data URL within the kind's size, or null. */
export function validLogo(value: unknown, kind: BrandKind = 'logo'): string | null {
  if (typeof value !== 'string' || value.length > BRAND_COLUMNS[kind].max) return null;
  return DATA_URL.test(value) ? value : null;
}
