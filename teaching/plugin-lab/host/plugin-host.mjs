/**
 * PLUGIN HOST — load, list, install, uninstall, EXPORT and IMPORT plugins. Offline.
 * PLUGIN-VERT — last, list, installer, avinstaller, EKSPORTER og IMPORTER plugins. Offline.
 *
 * Contract / Kontrakt:  plugin.json { id, namespace, version, main }
 *                       main module exports register(host) → host.provide(name, fn)
 */
import { readFile, writeFile, readdir, mkdir, rm, cp, stat } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ID = /^[a-z0-9][a-z0-9-]*$/, VER = /^\d+\.\d+\.\d+$/;
export const BUNDLE_FORMAT = 'plugin-bundle/1';

export function validateManifest(m) {
  for (const k of ['id', 'namespace', 'version', 'main'])
    if (typeof m?.[k] !== 'string') throw new Error(`manifest.${k} missing / mangler`);
  if (!ID.test(m.id) || !ID.test(m.namespace)) throw new Error('id/namespace: a-z 0-9 -');
  if (!VER.test(m.version)) throw new Error('version must be x.y.z');
  return m;
}

// Every file under dir → { "relative/path": "text" }, sorted for a stable hash.
async function readTree(dir, base = dir, out = {}) {
  for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await readTree(p, base, out);
    else out[relative(base, p).split(sep).join('/')] = await readFile(p, 'utf8');
  }
  return out;
}
const hashOf = files => createHash('sha256').update(JSON.stringify(files)).digest('hex');

export class PluginHost {
  /** @param {{dir: string}} opts  dir = where installed plugins live / hvor installerte plugins ligger */
  constructor({ dir }) {
    this.dir = resolve(dir);
    this.commands = new Map();   // "barcode.svg" → function
    this.plugins = new Map();    // id → { manifest, folder, commands }
  }

  // ── LOAD ───────────────────────────────────────────────────────────────────
  async loadAll() {
    await mkdir(this.dir, { recursive: true });
    for (const e of await readdir(this.dir, { withFileTypes: true }))
      if (e.isDirectory()) await this.#load(join(this.dir, e.name));
    return this.list();
  }

  async #load(folder) {
    const manifest = validateManifest(JSON.parse(await readFile(join(folder, 'plugin.json'), 'utf8')));
    if (this.plugins.has(manifest.id)) throw new Error(`already loaded / allerede lastet: ${manifest.id}`);
    const entry = resolve(folder, manifest.main);
    if (!entry.startsWith(resolve(folder) + sep)) throw new Error('main escapes plugin folder');
    const mod = await import(pathToFileURL(entry).href + `?t=${Date.now()}`);
    if (typeof mod.register !== 'function') throw new Error(`${manifest.id}: no register(host) export`);

    const mine = [];
    const api = {
      // EN: the plugin may only add commands inside its own namespace.
      // NO: pluginen kan bare legge til kommandoer i sitt eget navnerom.
      provide: (name, fn) => {
        if (!name.startsWith(manifest.namespace + '.')) throw new Error(`${name}: must start with "${manifest.namespace}."`);
        if (this.commands.has(name)) throw new Error(`${name}: already taken / allerede tatt`);
        this.commands.set(name, fn); mine.push(name);
      },
    };
    await mod.register(api);
    this.plugins.set(manifest.id, { manifest, folder, commands: mine });
  }

  // ── LIST / CALL ────────────────────────────────────────────────────────────
  list() {
    return [...this.plugins.values()].map(({ manifest, commands }) => ({
      id: manifest.id, version: manifest.version, description: manifest.description ?? '', commands,
    }));
  }
  call(name, ...args) {
    const fn = this.commands.get(name);
    if (!fn) throw new Error(`unknown command / ukjent kommando: ${name}`);
    return fn(...args);
  }

  // ── INSTALL / UNINSTALL ────────────────────────────────────────────────────
  async install(srcFolder) {
    const manifest = validateManifest(JSON.parse(await readFile(join(srcFolder, 'plugin.json'), 'utf8')));
    const target = join(this.dir, manifest.id);
    await rm(target, { recursive: true, force: true });
    await cp(srcFolder, target, { recursive: true });
    await this.#load(target);
    return manifest;
  }
  async uninstall(id) {
    const p = this.plugins.get(id);
    if (!p) throw new Error(`not installed / ikke installert: ${id}`);
    for (const c of p.commands) this.commands.delete(c);
    this.plugins.delete(id);
    await rm(p.folder, { recursive: true, force: true });
  }

  // ── EXPORT → one portable file / én bærbar fil ─────────────────────────────
  async exportPlugin(id, outDir = '.') {
    const p = this.plugins.get(id);
    if (!p) throw new Error(`not installed / ikke installert: ${id}`);
    const files = await readTree(p.folder);
    const bundle = { format: BUNDLE_FORMAT, manifest: p.manifest, files, sha256: hashOf(files) };
    await mkdir(outDir, { recursive: true });
    const out = join(outDir, `${id}-${p.manifest.version}.plugin.json`);
    await writeFile(out, JSON.stringify(bundle, null, 2));
    return out;
  }

  // ── IMPORT ← that file, verified first / den filen, verifisert først ───────
  async importBundle(file) {
    const b = JSON.parse(await readFile(file, 'utf8'));
    if (b.format !== BUNDLE_FORMAT) throw new Error('not a plugin bundle / ikke en plugin-pakke');
    if (hashOf(b.files) !== b.sha256) throw new Error('checksum mismatch — file changed / filen er endret');
    const manifest = validateManifest(b.manifest);
    const target = join(this.dir, manifest.id);
    await rm(target, { recursive: true, force: true });
    for (const [rel, text] of Object.entries(b.files)) {
      const dest = resolve(target, rel);
      if (!dest.startsWith(resolve(target) + sep)) throw new Error(`unsafe path / utrygg sti: ${rel}`);
      await mkdir(join(dest, '..'), { recursive: true });
      await writeFile(dest, text);
    }
    await this.#load(target);
    return manifest;
  }
}
