/**
 * Capabilities for ANY web page or WebView — no Capacitor, no framework, no dependencies.
 * Evner for HVILKEN SOM HELST nettside eller WebView — ingen Capacitor, ingen rammeverk.
 *
 * EN: A block asks the host for storage, a scanner, printing, sharing and a font.
 *     This file answers with what every browser already has. An app with more
 *     (Capacitor's camera scanner, the system print dialog) passes its own
 *     versions in `overrides` — see the Blocks app's `capabilities.ts` for a worked example.
 * NO: En blokk ber verten om lager, skanner, utskrift, deling og en font.
 *     Denne filen svarer med det alle nettlesere allerede har. En app med mer
 *     (Capacitors kameraskanner, systemets utskriftsdialog) gir sine egne
 *     versjoner i `overrides` — se Blocks-appens `capabilities.ts` som eksempel.
 */
import type { Capabilities, PluginStorage } from './pluginHost';

export interface WebCapabilityOptions {
  /** Prefix for localStorage keys, so two apps on one origin never collide. */
  prefix?: string;
  /** Replace or add any capability (scan, print, share, fontCss, storage). */
  overrides?: Partial<Capabilities>;
}

export function webCapabilities({ prefix = 'blocks', overrides = {} }: WebCapabilityOptions = {}): Capabilities {
  const storage = (pluginId: string): PluginStorage => {
    const k = (key: string) => `${prefix}.data.${pluginId}.${key}`;
    return {
      get<T>(key: string, fallback: T): T {
        try { const raw = localStorage.getItem(k(key)); return raw == null ? fallback : (JSON.parse(raw) as T); }
        catch { return fallback; }
      },
      set(key, value) { try { localStorage.setItem(k(key), JSON.stringify(value)); } catch { /* full or blocked */ } },
      remove(key) { try { localStorage.removeItem(k(key)); } catch { /* ignore */ } },
    };
  };

  // The browser's own print dialog (which also offers «Save as PDF»).
  const print: Capabilities['print'] = async html => {
    const w = window.open('', '_blank');
    if (!w) throw new Error('Allow pop-ups to print.');
    w.document.write(html); w.document.close(); w.focus(); w.print();
  };

  // A download, since a plain web page has no share sheet.
  const share: Capabilities['share'] = async (filename, base64, mime) => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    Object.assign(document.createElement('a'), { href: url, download: filename }).click();
    URL.revokeObjectURL(url);
  };

  // The browser's Contact Picker API — exists on Chrome for Android only. Elsewhere: no capability.
  // Nettleserens Contact Picker API — finnes bare i Chrome for Android. Ellers: ingen evne.
  const nav = typeof navigator !== 'undefined' ? (navigator as unknown as { contacts?: { select(p: string[]): Promise<{ name?: string[]; tel?: string[] }[]> } }) : undefined;
  const pickContact: Capabilities['pickContact'] = nav?.contacts?.select
    ? async () => {
        const [c] = await nav.contacts!.select(['name', 'tel']).catch(() => []);
        return c ? { name: (c.name?.[0] ?? '').trim(), phone: (c.tel?.[0] ?? '').replace(/[\s-]+/g, '') } : null;
      }
    : undefined;

  // No `scan` here on purpose: a block that sees no scanner offers a typed-code box instead.
  // Ingen `scan` her med vilje: en blokk uten skanner viser et felt for å skrive koden.
  return { storage, print, share, ...(pickContact ? { pickContact } : {}), ...overrides };
}
