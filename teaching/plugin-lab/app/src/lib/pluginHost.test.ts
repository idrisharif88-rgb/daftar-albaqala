// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PluginHost, makeBundle, parseBundle, type Bundle, type Loader, type Store } from './pluginHost';

const plugin = (dir: string, f: string) => readFileSync(new URL(`../../../plugins-available/${dir}/${f}`, import.meta.url), 'utf8');
// EN: node can import a data: URL; the phone uses a Blob URL. NO: node kan importere data:-URL; telefonen bruker Blob-URL.
const loader: Loader = code => import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const memory = (): Store => { let all: Record<string, Bundle> = {}; return { read: () => all, write: a => { all = a; } }; };
const barcode = () => makeBundle({ 'plugin.json': plugin('barcode-ean13', 'plugin.json'), 'index.mjs': plugin('barcode-ean13', 'index.mjs') });

describe('PluginHost (phone edition)', () => {
  it('installs, lists and runs a plugin', async () => {
    const h = new PluginHost(memory(), loader);
    await h.install(await barcode());
    expect(h.list()[0].id).toBe('barcode-ean13');
    expect(h.call('barcode.checkDigit', 400638133393)).toBe(1);
    const [c] = h.call('barcode.generate', 1) as string[];
    expect(h.call('barcode.validate', c)).toBe(c);
    expect(h.call('barcode.svg', '4006381333931')).toMatch(/^<svg/);
  });

  it('keeps plugins across a restart (same store)', async () => {
    const store = memory();
    await new PluginHost(store, loader).install(await barcode());
    const again = new PluginHost(store, loader);
    await again.loadAll();
    expect(again.list().map(p => p.id)).toEqual(['barcode-ean13']);
  });

  it('export → import round-trip between two "phones"', async () => {
    const a = new PluginHost(memory(), loader); await a.install(await barcode());
    const { filename, text } = a.exportBundle('barcode-ean13');
    expect(filename).toBe('barcode-ean13-1.0.0.plugin.json');
    const b = new PluginHost(memory(), loader);
    await b.install(await parseBundle(text));
    expect(b.call('barcode.checkDigit', '400638133393')).toBe(1);
    b.uninstall('barcode-ean13');
    expect(b.list()).toEqual([]);
    expect(() => b.call('barcode.svg', '4006381333931')).toThrow(/unknown command/);
  });

  it('refuses a tampered bundle', async () => {
    const a = new PluginHost(memory(), loader); await a.install(await barcode());
    const b = JSON.parse(a.exportBundle('barcode-ean13').text);
    b.files['index.mjs'] += '\n// evil';
    await expect(parseBundle(JSON.stringify(b))).rejects.toThrow(/checksum/);
  });

  it('refuses a command outside the plugin namespace and rolls back', async () => {
    const bad = await makeBundle({
      'plugin.json': JSON.stringify({ id: 'bad', namespace: 'bad', version: '1.0.0', main: 'i.mjs' }),
      'i.mjs': "export const register = h => { h.provide('bad.ok', () => 1); h.provide('barcode.hack', () => 2); };",
    });
    const h = new PluginHost(memory(), loader);
    await expect(h.install(bad)).rejects.toThrow(/must start with/);
    expect(() => h.call('bad.ok')).toThrow(/unknown command/);   // half-started plugin removed
    expect(h.list()).toEqual([]);
  });

  it('reads a bundle made by the command-line host', async () => {
    // same hashing rule: sha256(JSON.stringify(files)) with sorted file names
    const b = await barcode();
    const asCli = JSON.stringify({ format: b.format, manifest: b.manifest, files: b.files, sha256: b.sha256 });
    expect((await parseBundle(asCli)).manifest.id).toBe('barcode-ean13');
  });
});
