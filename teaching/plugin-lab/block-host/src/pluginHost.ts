/**
 * PLUGIN HOST (browser / phone edition) — same contract as host/plugin-host.mjs
 * PLUGIN-VERT (nettleser/telefon) — samme kontrakt som host/plugin-host.mjs
 *
 * EN: A plugin = manifest + a module exporting register(api). The host keeps
 *     plugins in a Store (offline, on the device) and runs them from a Blob URL.
 *     Bundles are the SAME file format as the command-line host, so a bundle
 *     exported on the laptop can be imported on the phone, and back.
 * NO: En plugin = manifest + en modul som eksporterer register(api). Verten
 *     lagrer plugins i en Store (offline, på enheten) og kjører dem fra en
 *     Blob-URL. Pakkene har SAMME filformat som kommandolinje-verten, så en
 *     pakke eksportert på laptopen kan importeres på telefonen, og omvendt.
 */

export const BUNDLE_FORMAT = 'plugin-bundle/1';

/** An error the screens can show in the person's own language (code → translation). */
export class PluginError extends Error {
  constructor(public code: 'notJson' | 'notBundle' | 'checksum', message: string) { super(message); }
}

export interface Manifest {
  id: string;
  namespace: string;
  version: string;
  main: string;
  description?: string;
  /** EN: sample arguments per command, shown in «Try». NO: eksempelargumenter per kommando. */
  examples?: Record<string, string>;
}
export interface Bundle {
  format: string;
  manifest: Manifest;
  files: Record<string, string>;
  sha256: string;
}
export interface Store {
  read(): Record<string, Bundle>;
  write(all: Record<string, Bundle>): void;
}
/** EN: per-plugin storage — a plugin never sees another plugin's data.
 *  NO: lager per plugin — en plugin ser aldri en annen plugins data. */
export interface PluginStorage {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}
/** EN: what the HOST can do for a screen. Every one is optional: a plugin must
 *      feature-detect, so it also runs in a host that lacks a camera or printer.
 *  NO: hva VERTEN kan gjøre for en skjerm. Alle er valgfrie: en plugin må sjekke,
 *      så den også virker i en vert uten kamera eller skriver. */
export interface ScreenCtx {
  storage: PluginStorage;
  /** Open the camera scanner; resolves to the code, or null if the person backed out. */
  scan?: () => Promise<string | null>;
  /** Show the system print dialog for a finished HTML page. */
  print?: (html: string, jobName: string) => Promise<void>;
  /** Let the person pick ONE contact from the phone: {name, phone}, or null if they backed out. */
  pickContact?: () => Promise<{ name: string; phone: string } | null>;
  /** Hand a finished file to the person: the system share sheet (WhatsApp, mail, Drive, a printer app…). */
  share?: (filename: string, base64: string, mime: string) => Promise<void>;
  /** @font-face CSS for the bundled Tajawal Bold, ready to put inside a printed page. */
  fontCss?: () => Promise<string>;
  /** Defaults the app embedding the plugin wants (colour, language, currency …). */
  options: Record<string, unknown>;
}
export interface Capabilities {
  storage(pluginId: string): PluginStorage;
  scan?: ScreenCtx['scan'];
  print?: ScreenCtx['print'];
  share?: ScreenCtx['share'];
  pickContact?: ScreenCtx['pickContact'];
  fontCss?: ScreenCtx['fontCss'];
}
export interface ScreenSpec {
  id: string;
  title: string;
  /** An emoji shown in the Apps list. */
  icon?: string;
  /** Draw into `el`. May return a cleanup function, called when the screen closes. */
  mount(el: HTMLElement, ctx: ScreenCtx): void | (() => void);
}
export interface HostApi {
  provide(name: string, fn: (...args: any[]) => unknown): void;
  /** Offer a whole screen (not just a command). Absent in a headless host — check first. */
  screen(spec: ScreenSpec): void;
}
export type PluginModule = { register?: (api: HostApi) => void | Promise<void> };
export type Loader = (code: string) => Promise<PluginModule>;

// ── Checks / Sjekker ─────────────────────────────────────────────────────────
const ID = /^[a-z0-9][a-z0-9-]*$/;
const VER = /^\d+\.\d+\.\d+$/;

export function validateManifest(m: any): Manifest {
  for (const k of ['id', 'namespace', 'version', 'main'])
    if (typeof m?.[k] !== 'string') throw new Error(`manifest.${k} is missing`);
  if (!ID.test(m.id) || !ID.test(m.namespace)) throw new Error('id/namespace: a-z 0-9 -');
  if (!VER.test(m.version)) throw new Error('version must be x.y.z');
  return m as Manifest;
}

/** SHA-256 of text, as hex. Needs a secure context (the APK's https://localhost is one). */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const hashFiles = (files: Record<string, string>) => sha256Hex(JSON.stringify(files));

/** Build a bundle with files sorted by name, so the hash is the same everywhere. */
export async function makeBundle(files: Record<string, string>): Promise<Bundle> {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  const manifest = validateManifest(JSON.parse(sorted['plugin.json'] ?? 'null'));
  if (!(manifest.main in sorted)) throw new Error(`main file missing: ${manifest.main}`);
  return { format: BUNDLE_FORMAT, manifest, files: sorted, sha256: await hashFiles(sorted) };
}

/** Read a bundle file's text: check format, checksum, manifest and paths. */
export async function parseBundle(text: string): Promise<Bundle> {
  let b: Bundle;
  try { b = JSON.parse(text); } catch { throw new PluginError('notJson', 'not JSON'); }
  if (b?.format !== BUNDLE_FORMAT || typeof b.files !== 'object' || !b.files)
    throw new PluginError('notBundle', 'not a plugin bundle');
  if ((await hashFiles(b.files)) !== b.sha256)
    throw new PluginError('checksum', 'checksum mismatch — file changed');
  const manifest = validateManifest(b.manifest);
  for (const path of Object.keys(b.files))
    if (path.startsWith('/') || path.split('/').includes('..')) throw new Error(`unsafe path: ${path}`);
  if (typeof b.files[manifest.main] !== 'string') throw new Error(`main file missing: ${manifest.main}`);
  return b;
}

// ── Loading code / Laste kode ────────────────────────────────────────────────
/** EN: run the plugin's main file as an ES module via a Blob URL.
 *  NO: kjør pluginens hovedfil som en ES-modul via en Blob-URL. */
export const blobLoader: Loader = async code => {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try { return await import(/* @vite-ignore */ url); } finally { URL.revokeObjectURL(url); }
};

/** The device's own storage — survives restarts, no network. / Enhetens eget lager. */
export const localStore: Store = {
  read() {
    try { return JSON.parse(localStorage.getItem('plugin-lab.plugins') ?? '{}'); } catch { return {}; }
  },
  write(all) {
    try { localStorage.setItem('plugin-lab.plugins', JSON.stringify(all)); } catch { /* full/blocked */ }
  },
};

// ── The host / Verten ────────────────────────────────────────────────────────
export interface PluginInfo { id: string; version: string; description: string; commands: string[]; screens: string[]; examples: Record<string, string> }
export interface ScreenInfo { pluginId: string; id: string; title: string; icon: string }

/** Storage that lives only in memory — for tests and hosts without a disk. */
export const memoryCapabilities = (): Capabilities => {
  const data = new Map<string, unknown>();
  return {
    storage: pluginId => ({
      get: <T,>(k: string, fb: T) => (data.has(`${pluginId}/${k}`) ? structuredClone(data.get(`${pluginId}/${k}`)) as T : fb),
      set: (k, v) => { data.set(`${pluginId}/${k}`, structuredClone(v)); },
      remove: k => { data.delete(`${pluginId}/${k}`); },
    }),
  };
};

export class PluginHost {
  private commands = new Map<string, (...a: any[]) => unknown>();
  private plugins = new Map<string, { manifest: Manifest; commands: string[]; screens: string[] }>();
  private screenMap = new Map<string, { pluginId: string; spec: ScreenSpec }>();
  /** Plugins that were stored but would not start. / Plugins som ikke ville starte. */
  failed: { id: string; message: string }[] = [];
  private loading?: Promise<void>;

  constructor(
    private store: Store,
    private loader: Loader = blobLoader,
    private caps: Capabilities = memoryCapabilities(),
  ) {}

  /** Start every stored plugin (once — React StrictMode may ask twice). */
  loadAll(): Promise<void> {
    return (this.loading ??= (async () => {
      for (const b of Object.values(this.store.read())) {
        try { await this.load(b); }
        catch (e) { this.failed.push({ id: b.manifest?.id ?? '?', message: (e as Error).message }); }
      }
    })());
  }

  private async load(b: Bundle) {
    const { manifest } = b;
    const mine: string[] = [];
    const mineScreens: string[] = [];
    const api: HostApi = {
      screen: spec => {
        const key = `${manifest.id}/${spec.id}`;
        if (this.screenMap.has(key)) throw new Error(`${key}: screen already taken`);
        this.screenMap.set(key, { pluginId: manifest.id, spec }); mineScreens.push(key);
      },
      // EN: a plugin may only add commands inside its own namespace.
      // NO: en plugin kan bare legge til kommandoer i sitt eget navnerom.
      provide: (name, fn) => {
        if (!name.startsWith(manifest.namespace + '.')) throw new Error(`${name}: must start with "${manifest.namespace}."`);
        if (this.commands.has(name)) throw new Error(`${name}: already taken`);
        this.commands.set(name, fn); mine.push(name);
      },
    };
    try {
      const mod = await this.loader(b.files[manifest.main]);
      if (typeof mod.register !== 'function') throw new Error(`${manifest.id}: no register(api) export`);
      await mod.register(api);
    } catch (e) {
      for (const c of mine) this.commands.delete(c);   // roll back a half-started plugin
      for (const k of mineScreens) this.screenMap.delete(k);
      throw e;
    }
    this.plugins.set(manifest.id, { manifest, commands: mine, screens: mineScreens });
  }

  list(): PluginInfo[] {
    return [...this.plugins.values()].map(({ manifest, commands, screens }) => ({
      id: manifest.id, version: manifest.version, description: manifest.description ?? '',
      commands, screens: screens.map(k => this.screenMap.get(k)!.spec.title), examples: manifest.examples ?? {},
    }));
  }

  /** Every screen any plugin offers — what the «Apps» tab lists. */
  screens(): ScreenInfo[] {
    return [...this.screenMap.values()].map(({ pluginId, spec }) => ({
      pluginId, id: spec.id, title: spec.title, icon: spec.icon ?? '🧩',
    }));
  }

  /** Draw a plugin's screen into `el`. Returns the function that closes it. */
  mountScreen(pluginId: string, screenId: string, el: HTMLElement, options: Record<string, unknown> = {}): () => void {
    const entry = this.screenMap.get(`${pluginId}/${screenId}`);
    if (!entry) throw new Error(`unknown screen: ${pluginId}/${screenId}`);
    const c = this.caps;
    const cleanup = entry.spec.mount(el, {
      storage: c.storage(pluginId), scan: c.scan, print: c.print, share: c.share, pickContact: c.pickContact, fontCss: c.fontCss, options,
    });
    return () => { try { cleanup?.(); } finally { el.replaceChildren(); } };
  }
  has(id: string) { return this.plugins.has(id); }

  call(name: string, ...args: unknown[]) {
    const fn = this.commands.get(name);
    if (!fn) throw new Error(`unknown command: ${name}`);
    return fn(...args);
  }

  /** Install (or replace) a verified bundle and remember it. */
  async install(b: Bundle) {
    await this.loadAll();
    if (this.plugins.has(b.manifest.id)) this.unload(b.manifest.id);
    await this.load(b);
    this.store.write({ ...this.store.read(), [b.manifest.id]: b });
    this.failed = this.failed.filter(f => f.id !== b.manifest.id);
  }
  private unload(id: string) {
    const p = this.plugins.get(id);
    for (const c of p?.commands ?? []) this.commands.delete(c);
    for (const k of p?.screens ?? []) this.screenMap.delete(k);
    this.plugins.delete(id);
  }
  uninstall(id: string) {
    this.unload(id);
    const { [id]: _gone, ...rest } = this.store.read();
    this.store.write(rest);
    this.failed = this.failed.filter(f => f.id !== id);
  }
  /** The bundle file's text and a good file name. / Pakkens tekst og et godt filnavn. */
  exportBundle(id: string) {
    const b = this.store.read()[id];
    if (!b) throw new Error(`not installed: ${id}`);
    return { filename: `${id}-${b.manifest.version}.plugin.json`, text: JSON.stringify(b, null, 2) };
  }
}
