import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginHost } from '../host/plugin-host.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins-available', 'barcode-ean13');
const fresh = async () => new PluginHost({ dir: await mkdtemp(join(tmpdir(), 'host-')) });

test('install → list → call', async () => {
  const h = await fresh(); await h.install(SRC);
  assert.equal(h.list()[0].id, 'barcode-ean13');
  assert.equal(h.call('barcode.checkDigit', '400638133393'), 1);          // real pen
  const [c] = h.call('barcode.generate', 1);
  assert.equal(h.call('barcode.validate', c), c);
  assert.equal(h.call('barcode.validate', '4006381333931'), null);        // not our range
  assert.equal(h.call('barcode.validate', '4006381333931', true), '4006381333931');
});

test('generated codes never repeat existing ones', async () => {
  const h = await fresh(); await h.install(SRC);
  const codes = h.call('barcode.generate', 200);
  assert.equal(new Set(codes).size, 200);
});

test('SVG pattern is 95 modules and decodes back to the digits', async () => {
  const { toModules } = await import(join(SRC, 'index.mjs'));
  const bits = toModules('4006381333931');
  assert.equal(bits.length, 95);
  assert.match(bits, /^101.{42}01010.{42}101$/);
  const h = await fresh(); await h.install(SRC);
  assert.match(h.call('barcode.svg', '4006381333931'), /^<svg[\s\S]*<\/svg>$/);
});

test('export → uninstall → import round-trip', async () => {
  const a = await fresh(); await a.install(SRC);
  const file = await a.exportPlugin('barcode-ean13', await mkdtemp(join(tmpdir(), 'out-')));
  const b = await fresh();                                                // another "app"
  await b.importBundle(file);
  assert.deepEqual(b.list().map(p => p.id), ['barcode-ean13']);
  await b.uninstall('barcode-ean13');
  assert.equal(b.list().length, 0);
  assert.throws(() => b.call('barcode.svg', '4006381333931'), /unknown command/);
});

test('tampered bundle is refused', async () => {
  const a = await fresh(); await a.install(SRC);
  const file = await a.exportPlugin('barcode-ean13', await mkdtemp(join(tmpdir(), 'out-')));
  const b = JSON.parse(await readFile(file, 'utf8'));
  b.files['index.mjs'] += '\n// evil';
  await writeFile(file, JSON.stringify(b));
  await assert.rejects((await fresh()).importBundle(file), /checksum/);
});

test('a plugin cannot take commands outside its namespace', async () => {
  const h = await fresh();
  const dir = await mkdtemp(join(tmpdir(), 'bad-'));
  await writeFile(join(dir, 'plugin.json'), JSON.stringify({ id: 'bad', namespace: 'bad', version: '1.0.0', main: 'i.mjs' }));
  await writeFile(join(dir, 'i.mjs'), "export const register = h => h.provide('barcode.hack', () => 1);");
  await assert.rejects(h.install(dir), /must start with/);
});

test('numbers are accepted where codes are expected (CLI passes JSON)', async () => {
  const h = await fresh(); await h.install(SRC);
  assert.equal(h.call('barcode.checkDigit', 400638133393), 1);
  assert.match(h.call('barcode.svg', 4006381333931), /<svg/);
});
