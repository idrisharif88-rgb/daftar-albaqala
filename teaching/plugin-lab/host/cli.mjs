#!/usr/bin/env node
// Small command line for the host / Liten kommandolinje for verten.
import { PluginHost } from './plugin-host.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const host = new PluginHost({ dir: join(here, 'installed') });
const [cmd, ...rest] = process.argv.slice(2);
// EN: long digit strings (barcodes!) stay text — JSON.parse would drop leading zeros.
// NO: lange siffer-strenger (strekkoder!) forblir tekst — JSON.parse mister ledende nuller.
const json = s => { if (/^\d{9,}$/.test(s)) return s; try { return JSON.parse(s); } catch { return s; } };

const help = `
  list                     show installed plugins / vis installerte plugins
  install <folder>         install from a folder / installer fra mappe
  uninstall <id>           remove / fjern
  export <id> [outDir]     pack into <id>-<ver>.plugin.json
  import <file>            install from a bundle file / fra pakkefil
  call <cmd> [args...]     run a command, args are JSON / kjør kommando
`;
try {
  await host.loadAll();
  if (cmd === 'list') console.table(host.list().map(p => ({ ...p, commands: p.commands.join(', ') })));
  else if (cmd === 'install') console.log('✅ installed', (await host.install(rest[0])).id);
  else if (cmd === 'uninstall') { await host.uninstall(rest[0]); console.log('🗑  removed', rest[0]); }
  else if (cmd === 'export') console.log('📦', await host.exportPlugin(rest[0], rest[1] ?? '.'));
  else if (cmd === 'import') console.log('✅ imported', (await host.importBundle(rest[0])).id);
  else if (cmd === 'call') console.log(await host.call(rest[0], ...rest.slice(1).map(json)));
  else console.log(help);
} catch (e) { console.error('❌', e.message); process.exitCode = 1; }
