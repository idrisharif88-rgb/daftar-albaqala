import { useEffect, useState } from 'react';
import { accountLogo } from './api';

// The shop's own logo, set by the developer in the Watcher (server 024).
// /me says WHEN it last changed (`brand_logo_at`); the image itself is
// fetched only when that differs from the cached copy, and kept in
// localStorage so Home shows it at once, offline included.

const KEY = 'daftar.brand-logo';
export const BRAND_LOGO_EVENT = 'daftar:brand-logo';

interface Cached { at: string; logo: string }

function read(): Cached | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Cached) : null;
  } catch { return null; }
}

function write(value: Cached | null): void {
  try {
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else localStorage.removeItem(KEY);
  } catch { /* storage full or blocked: the letter badge stays */ }
  window.dispatchEvent(new Event(BRAND_LOGO_EVENT));
}

/** Bring the cached logo in line with the server's `brand_logo_at`. */
export async function syncBrandLogo(at: string | null | undefined): Promise<void> {
  if (at === undefined) return; // an older server: leave whatever is there
  const cached = read();
  if (!at) { if (cached) write(null); return; }
  if (cached?.at === at) return;
  try {
    const res = await accountLogo();
    write(res.logo ? { at, logo: res.logo } : null);
  } catch { /* offline: try again on the next /me */ }
}

/** Forget it (sign-out: the next account must not inherit this shop's logo). */
export function clearBrandLogo(): void {
  write(null);
}

/** The logo data URL, or null — re-renders when it changes. */
export function useBrandLogo(): string | null {
  const [logo, setLogo] = useState<string | null>(() => read()?.logo ?? null);
  useEffect(() => {
    const on = () => setLogo(read()?.logo ?? null);
    window.addEventListener(BRAND_LOGO_EVENT, on);
    return () => window.removeEventListener(BRAND_LOGO_EVENT, on);
  }, []);
  return logo;
}
