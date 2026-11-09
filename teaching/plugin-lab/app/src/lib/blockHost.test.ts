// @vitest-environment jsdom
// Tests the SOCKET package on its own: a host built only from block-host (no Capacitor, no Ionic).
import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import deskSrc from '../../../plugins-available/barcode-desk/index.mjs?raw';
import deskManifest from '../../../plugins-available/barcode-desk/plugin.json?raw';
import { PluginHost, webCapabilities, makeBundle, parseBundle, type Bundle, type Loader, type Store } from '../../../block-host/src/index';

const loader: Loader = code => import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const memory = (): Store => { let all: Record<string, Bundle> = {}; return { read: () => all, write: a => { all = a; } }; };

describe('block-host', () => {
  it('web capabilities: storage is namespaced per block and per app prefix', () => {
    const a = webCapabilities({ prefix: 'appA' }), b = webCapabilities({ prefix: 'appB' });
    a.storage('x').set('k', { n: 1 });
    expect(a.storage('x').get('k', null)).toEqual({ n: 1 });
    expect(a.storage('y').get('k', 'none')).toBe('none');       // another block cannot see it
    expect(b.storage('x').get('k', 'none')).toBe('none');       // nor can another app
    a.storage('x').remove('k');
    expect(a.storage('x').get('k', 'gone')).toBe('gone');
  });

  it('a plain web host runs Barcode Desk with NO scanner and degrades politely', async () => {
    const host = new PluginHost(memory(), loader, webCapabilities({ prefix: 't' }));
    await host.install(await makeBundle({ 'plugin.json': deskManifest, 'index.mjs': deskSrc }));
    const el = document.createElement('div');
    host.mountScreen('barcode-desk', 'desk', el, { lang: 'no' });
    (el.querySelector('[data-tab=scan]') as HTMLElement).click();
    expect(el.querySelector('[data-act=scan]')).toBeNull();                    // no camera button…
    expect(el.textContent).toContain('Ingen kameraskanner her');                // …and it says so, in the host's language
  });

  it('overrides add a capability the web does not have', async () => {
    const calls: string[] = [];
    const host = new PluginHost(memory(), loader, webCapabilities({ overrides: { scan: async () => { calls.push('scan'); return null; } } }));
    await host.install(await makeBundle({ 'plugin.json': deskManifest, 'index.mjs': deskSrc }));
    const el = document.createElement('div');
    host.mountScreen('barcode-desk', 'desk', el);
    (el.querySelector('[data-tab=scan]') as HTMLElement).click();
    expect(el.querySelector('[data-act=scan]')).not.toBeNull();
  });

  it('exports a block and another host imports it (checksum verified)', async () => {
    const a = new PluginHost(memory(), loader, webCapabilities());
    await a.install(await makeBundle({ 'plugin.json': deskManifest, 'index.mjs': deskSrc }));
    const { text } = a.exportBundle('barcode-desk');
    const b = new PluginHost(memory(), loader, webCapabilities());
    await b.install(await parseBundle(text));
    expect(b.screens().map(s => s.id)).toEqual(['desk']);
  });

  it('the built single file (dist/block-host.mjs) exports the same API', async () => {
    const dist = await import(/* @vite-ignore */ pathToFileURL(resolve(__dirname, '../../../block-host/dist/block-host.mjs')).href);
    for (const name of ['PluginHost', 'PluginError', 'blobLoader', 'makeBundle', 'parseBundle', 'validateManifest', 'webCapabilities'])
      expect(typeof dist[name], name).toBe('function');
    expect(typeof dist.localStore.read).toBe('function');
    expect(dist.BUNDLE_FORMAT).toBe('plugin-bundle/1');
    const host = new dist.PluginHost(memory(), loader, dist.webCapabilities());
    await host.install(await dist.makeBundle({ 'plugin.json': deskManifest, 'index.mjs': deskSrc }));
    expect(host.list()[0].id).toBe('barcode-desk');
  });
});
