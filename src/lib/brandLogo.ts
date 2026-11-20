import { useEffect, useState } from 'react';
import { accountLogo } from './api';

// The shop's own pictures, set by the developer in the Watcher (server 024/025):
//   logo  — the small badge beside the greeting on Home
//   intro — the whole card, played full-screen once after sign-in (BrandIntro)
// /me says WHEN each last changed; a picture is fetched only when that differs
// from the cached copy, and kept in localStorage so it shows at once, offline too.

export type BrandKind = 'logo' | 'intro';
const KEY: Record<BrandKind, string> = { logo: 'daftar.brand-logo', intro: 'daftar.brand-intro' };
export const BRAND_LOGO_EVENT = 'daftar:brand-logo';

interface Cached { at: string; logo: string }

function read(kind: BrandKind): Cached | null {
  try {
    const raw = localStorage.getItem(KEY[kind]);
    return raw ? (JSON.parse(raw) as Cached) : null;
  } catch { return null; }
}

function write(kind: BrandKind, value: Cached | null): void {
  try {
    if (value) localStorage.setItem(KEY[kind], JSON.stringify(value));
    else localStorage.removeItem(KEY[kind]);
  } catch { /* storage full or blocked: the picture simply isn't shown */ }
  window.dispatchEvent(new Event(BRAND_LOGO_EVENT));
}

/** Bring one cached picture in line with the server's timestamp for it. */
export async function syncBrandLogo(at: string | null | undefined, kind: BrandKind = 'logo'): Promise<void> {
  if (at === undefined) return; // an older server: leave whatever is there
  const cached = read(kind);
  if (!at) { if (cached) write(kind, null); return; }
  if (cached?.at === at) return;
  try {
    const res = await accountLogo(kind);
    write(kind, res.logo ? { at, logo: res.logo } : null);
  } catch { /* offline: try again on the next /me */ }
}

/** Forget both (sign-out: the next account must not inherit this shop's pictures). */
export function clearBrandLogo(): void {
  write('logo', null);
  write('intro', null);
}

/** The picture's data URL, or null — re-renders when it changes. */
export function useBrandLogo(kind: BrandKind = 'logo'): string | null {
  const [logo, setLogo] = useState<string | null>(() => read(kind)?.logo ?? null);
  useEffect(() => {
    const on = () => setLogo(read(kind)?.logo ?? null);
    on();
    window.addEventListener(BRAND_LOGO_EVENT, on);
    return () => window.removeEventListener(BRAND_LOGO_EVENT, on);
  }, [kind]);
  return logo;
}

// ---- "play the intro once, after this sign-in" ----
// login() stamps the moment; BrandIntro plays if the picture is there within
// INTRO_WAIT_MS of it (it may arrive a moment later: /me → download), else it
// lapses quietly — an account without an intro never notices. sessionStorage:
// an app restart must NOT replay it (owner: every open would waste time).
const INTRO_PENDING = 'daftar.brand-intro-pending';
const INTRO_WAIT_MS = 8000;
export function markIntroPending(): void {
  try { sessionStorage.setItem(INTRO_PENDING, String(Date.now())); } catch { /* no intro then */ }
  window.dispatchEvent(new Event(BRAND_LOGO_EVENT)); // BrandIntro looks now, before the book renders
}
export function introPending(now = Date.now()): boolean {
  try {
    const at = Number(sessionStorage.getItem(INTRO_PENDING));
    return at > 0 && now - at <= INTRO_WAIT_MS;
  } catch { return false; }
}
export function clearIntroPending(): void {
  try { sessionStorage.removeItem(INTRO_PENDING); } catch { /* nothing to clear */ }
}
