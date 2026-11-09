var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/pluginHost.ts
var BUNDLE_FORMAT = "plugin-bundle/1";
var PluginError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
var ID = /^[a-z0-9][a-z0-9-]*$/;
var VER = /^\d+\.\d+\.\d+$/;
function validateManifest(m) {
  for (const k of ["id", "namespace", "version", "main"])
    if (typeof m?.[k] !== "string") throw new Error(`manifest.${k} is missing`);
  if (!ID.test(m.id) || !ID.test(m.namespace)) throw new Error("id/namespace: a-z 0-9 -");
  if (!VER.test(m.version)) throw new Error("version must be x.y.z");
  return m;
}
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
var hashFiles = (files) => sha256Hex(JSON.stringify(files));
async function makeBundle(files) {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  const manifest = validateManifest(JSON.parse(sorted["plugin.json"] ?? "null"));
  if (!(manifest.main in sorted)) throw new Error(`main file missing: ${manifest.main}`);
  return { format: BUNDLE_FORMAT, manifest, files: sorted, sha256: await hashFiles(sorted) };
}
async function parseBundle(text) {
  let b;
  try {
    b = JSON.parse(text);
  } catch {
    throw new PluginError("notJson", "not JSON");
  }
  if (b?.format !== BUNDLE_FORMAT || typeof b.files !== "object" || !b.files)
    throw new PluginError("notBundle", "not a plugin bundle");
  if (await hashFiles(b.files) !== b.sha256)
    throw new PluginError("checksum", "checksum mismatch \u2014 file changed");
  const manifest = validateManifest(b.manifest);
  for (const path of Object.keys(b.files))
    if (path.startsWith("/") || path.split("/").includes("..")) throw new Error(`unsafe path: ${path}`);
  if (typeof b.files[manifest.main] !== "string") throw new Error(`main file missing: ${manifest.main}`);
  return b;
}
var blobLoader = async (code) => {
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    return await import(
      /* @vite-ignore */
      url
    );
  } finally {
    URL.revokeObjectURL(url);
  }
};
var localStore = {
  read() {
    try {
      return JSON.parse(localStorage.getItem("plugin-lab.plugins") ?? "{}");
    } catch {
      return {};
    }
  },
  write(all) {
    try {
      localStorage.setItem("plugin-lab.plugins", JSON.stringify(all));
    } catch {
    }
  }
};
var memoryCapabilities = () => {
  const data = /* @__PURE__ */ new Map();
  return {
    storage: (pluginId) => ({
      get: (k, fb) => data.has(`${pluginId}/${k}`) ? structuredClone(data.get(`${pluginId}/${k}`)) : fb,
      set: (k, v) => {
        data.set(`${pluginId}/${k}`, structuredClone(v));
      },
      remove: (k) => {
        data.delete(`${pluginId}/${k}`);
      }
    })
  };
};
var PluginHost = class {
  constructor(store, loader = blobLoader, caps = memoryCapabilities()) {
    this.store = store;
    this.loader = loader;
    this.caps = caps;
    __publicField(this, "commands", /* @__PURE__ */ new Map());
    __publicField(this, "plugins", /* @__PURE__ */ new Map());
    __publicField(this, "screenMap", /* @__PURE__ */ new Map());
    /** Plugins that were stored but would not start. / Plugins som ikke ville starte. */
    __publicField(this, "failed", []);
    __publicField(this, "loading");
  }
  /** Start every stored plugin (once — React StrictMode may ask twice). */
  loadAll() {
    return this.loading ?? (this.loading = (async () => {
      for (const b of Object.values(this.store.read())) {
        try {
          await this.load(b);
        } catch (e) {
          this.failed.push({ id: b.manifest?.id ?? "?", message: e.message });
        }
      }
    })());
  }
  async load(b) {
    const { manifest } = b;
    const mine = [];
    const mineScreens = [];
    const api = {
      screen: (spec) => {
        const key = `${manifest.id}/${spec.id}`;
        if (this.screenMap.has(key)) throw new Error(`${key}: screen already taken`);
        this.screenMap.set(key, { pluginId: manifest.id, spec });
        mineScreens.push(key);
      },
      // EN: a plugin may only add commands inside its own namespace.
      // NO: en plugin kan bare legge til kommandoer i sitt eget navnerom.
      provide: (name, fn) => {
        if (!name.startsWith(manifest.namespace + ".")) throw new Error(`${name}: must start with "${manifest.namespace}."`);
        if (this.commands.has(name)) throw new Error(`${name}: already taken`);
        this.commands.set(name, fn);
        mine.push(name);
      }
    };
    try {
      const mod = await this.loader(b.files[manifest.main]);
      if (typeof mod.register !== "function") throw new Error(`${manifest.id}: no register(api) export`);
      await mod.register(api);
    } catch (e) {
      for (const c of mine) this.commands.delete(c);
      for (const k of mineScreens) this.screenMap.delete(k);
      throw e;
    }
    this.plugins.set(manifest.id, { manifest, commands: mine, screens: mineScreens });
  }
  list() {
    return [...this.plugins.values()].map(({ manifest, commands, screens }) => ({
      id: manifest.id,
      version: manifest.version,
      description: manifest.description ?? "",
      commands,
      screens: screens.map((k) => this.screenMap.get(k).spec.title),
      examples: manifest.examples ?? {}
    }));
  }
  /** Every screen any plugin offers — what the «Apps» tab lists. */
  screens() {
    return [...this.screenMap.values()].map(({ pluginId, spec }) => ({
      pluginId,
      id: spec.id,
      title: spec.title,
      icon: spec.icon ?? "\u{1F9E9}"
    }));
  }
  /** Draw a plugin's screen into `el`. Returns the function that closes it. */
  mountScreen(pluginId, screenId, el, options = {}) {
    const entry = this.screenMap.get(`${pluginId}/${screenId}`);
    if (!entry) throw new Error(`unknown screen: ${pluginId}/${screenId}`);
    const c = this.caps;
    const cleanup = entry.spec.mount(el, {
      storage: c.storage(pluginId),
      scan: c.scan,
      print: c.print,
      share: c.share,
      pickContact: c.pickContact,
      fontCss: c.fontCss,
      options
    });
    return () => {
      try {
        cleanup?.();
      } finally {
        el.replaceChildren();
      }
    };
  }
  has(id) {
    return this.plugins.has(id);
  }
  call(name, ...args) {
    const fn = this.commands.get(name);
    if (!fn) throw new Error(`unknown command: ${name}`);
    return fn(...args);
  }
  /** Install (or replace) a verified bundle and remember it. */
  async install(b) {
    await this.loadAll();
    if (this.plugins.has(b.manifest.id)) this.unload(b.manifest.id);
    await this.load(b);
    this.store.write({ ...this.store.read(), [b.manifest.id]: b });
    this.failed = this.failed.filter((f) => f.id !== b.manifest.id);
  }
  unload(id) {
    const p = this.plugins.get(id);
    for (const c of p?.commands ?? []) this.commands.delete(c);
    for (const k of p?.screens ?? []) this.screenMap.delete(k);
    this.plugins.delete(id);
  }
  uninstall(id) {
    this.unload(id);
    const { [id]: _gone, ...rest } = this.store.read();
    this.store.write(rest);
    this.failed = this.failed.filter((f) => f.id !== id);
  }
  /** The bundle file's text and a good file name. / Pakkens tekst og et godt filnavn. */
  exportBundle(id) {
    const b = this.store.read()[id];
    if (!b) throw new Error(`not installed: ${id}`);
    return { filename: `${id}-${b.manifest.version}.plugin.json`, text: JSON.stringify(b, null, 2) };
  }
};

// src/webCapabilities.ts
function webCapabilities({ prefix = "blocks", overrides = {} } = {}) {
  const storage = (pluginId) => {
    const k = (key) => `${prefix}.data.${pluginId}.${key}`;
    return {
      get(key, fallback) {
        try {
          const raw = localStorage.getItem(k(key));
          return raw == null ? fallback : JSON.parse(raw);
        } catch {
          return fallback;
        }
      },
      set(key, value) {
        try {
          localStorage.setItem(k(key), JSON.stringify(value));
        } catch {
        }
      },
      remove(key) {
        try {
          localStorage.removeItem(k(key));
        } catch {
        }
      }
    };
  };
  const print = async (html) => {
    const w = window.open("", "_blank");
    if (!w) throw new Error("Allow pop-ups to print.");
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };
  const share = async (filename, base64, mime) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    Object.assign(document.createElement("a"), { href: url, download: filename }).click();
    URL.revokeObjectURL(url);
  };
  const nav = typeof navigator !== "undefined" ? navigator : void 0;
  const pickContact = nav?.contacts?.select ? async () => {
    const [c] = await nav.contacts.select(["name", "tel"]).catch(() => []);
    return c ? { name: (c.name?.[0] ?? "").trim(), phone: (c.tel?.[0] ?? "").replace(/[\s-]+/g, "") } : null;
  } : void 0;
  return { storage, print, share, ...pickContact ? { pickContact } : {}, ...overrides };
}
export {
  BUNDLE_FORMAT,
  PluginError,
  PluginHost,
  blobLoader,
  localStore,
  makeBundle,
  memoryCapabilities,
  parseBundle,
  sha256Hex,
  validateManifest,
  webCapabilities
};
