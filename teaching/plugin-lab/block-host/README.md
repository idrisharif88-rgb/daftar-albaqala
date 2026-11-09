# block-host — the socket for blocks / kontakten for blokker

**EN.** A *block* (plugin) is a plug; the *host* is the socket. This folder is the socket, on its
own, so **any web-based app** (React, Ionic, Vue, a plain page, a Capacitor/Cordova WebView) can
import, list, run and export blocks — offline, with no dependencies.

**NO.** En *blokk* (plugin) er en plugg; *verten* er kontakten. Denne mappen er kontakten alene,
så **enhver nettbasert app** kan importere, liste, kjøre og eksportere blokker — offline, uten avhengigheter.

```
block-host/
├── src/pluginHost.ts        the socket: load, install, list, run, mount, export, import (checksum-verified)
├── src/webCapabilities.ts   what every browser can lend a block: storage, print, share
├── src/index.ts             exports both
├── dist/block-host.mjs      the same, built into ONE file (9 KB) for pages without a build step
└── examples/plain-web/      a complete working page that accepts blocks (no framework)
```

## Add it to your app in 5 steps / Legg den til i appen din i 5 steg

```ts
// 1 · import (TypeScript project: copy this folder; plain page: use dist/block-host.mjs)
import { PluginHost, blobLoader, localStore, webCapabilities, parseBundle } from 'block-host';

// 2 · make ONE host for the whole app
//     (where blocks are kept · how they are loaded · what they may ask for)
const host = new PluginHost(localStore, blobLoader, webCapabilities({ prefix: 'myapp' }));

// 3 · start the blocks installed earlier
await host.loadAll();

// 4 · let the person add one: a file exported by any host. It is verified BEFORE it runs.
await host.install(await parseBundle(await file.text()));

// 5 · list screens, and open one inside any element
host.screens();                                     // [{ pluginId, id, title, icon }]
const close = host.mountScreen('barcode-desk', 'desk', someDiv, { lang: 'en' });
close();                                            // when the screen goes away
```

Also available: `host.list()`, `host.uninstall(id)`, `host.exportBundle(id)` → `{ filename, text }`
(save or share the text — it is the portable block file), and `host.call('ns.command', ...args)` for
command-only blocks.

## What a block may ask the host for / Hva en blokk kan be verten om

| Capability | `webCapabilities()` gives | Give more by passing `overrides` |
|---|---|---|
| `storage` | `localStorage`, one namespace per block | a database |
| `print(html, jobName)` | the browser print dialog | Android's system print dialog |
| `share(file, base64, mime)` | a download | the phone's share sheet |
| `scan()` | *(none)* — the block shows a typed-code box | Google/ML Kit camera scanner |
| `pickContact()` | Chrome-for-Android's Contact Picker if present, else *(none)* — the block hides its button | Android's own picker (one row, **no permission**) |
| `fontCss()` | *(none)* — the block falls back to a system font | a bundled font as base64 |
| `options` | whatever you pass to `mountScreen(…, options)` | language, colours, currency |

**A missing capability is not an error.** Blocks check first and degrade gracefully — that is what
makes one block run in very different apps. A worked example of the richer version (scanner,
print dialog, share sheet, Tajawal font) is `app/src/lib/capabilities.ts` in the Blocks app.

## Rules for writing a block / Regler for å skrive en blokk

1. **Two files:** `plugin.json` (`id`, `namespace`, `version`, `main`) and ONE JavaScript module
   (`main`) with no imports. The phone loads it from a Blob URL, so it cannot import siblings.
2. **`export function register(host)`** — the only door in. Offer a screen with
   `host.screen?.({ id, title, icon, mount(el, ctx) { … return cleanup; } })` and/or commands with
   `host.provide('namespace.name', fn)`. Names must start with your `namespace` — a block cannot
   take another block's commands.
3. **Draw with plain DOM** into `el`; read `ctx.storage`, `ctx.scan?`, `ctx.print?`, `ctx.share?`,
   `ctx.fontCss?`, `ctx.options`. Never import the app.

## Security — read this / Sikkerhet — les dette

A block is **code that runs inside your app with full access to the page**. The checksum proves a
file was not *changed* after export; it does **not** prove the author is trustworthy. Import only
blocks you trust, and — if you ship an app to a store — check the store's rules about loading code
at run time before you let users import files from strangers.

## Try it / Prøv det

```bash
cd teaching/plugin-lab
python3 -m http.server 8000
# open http://localhost:8000/block-host/examples/plain-web/  → «Install Barcode Desk»
```

Rebuild `dist/` after editing `src/`: `cd block-host && npx esbuild src/index.ts --bundle --format=esm --target=es2020 --outfile=dist/block-host.mjs`.
