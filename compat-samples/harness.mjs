// Load-time harness — replicates the 全视维 Obsidian shim in Node and tries
// to actually evaluate a plugin's `main.js` bundle, then instantiate the
// exported Plugin class and call `load()`. Reports which property reads /
// method calls trigger the "missing" stub paths.
//
// This is NOT a full Obsidian replacement; the goal is to find the *first*
// failure point and the call site so we can prioritise shim additions.
//
// Usage:  node harness.mjs <plugin-folder>

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const folder = process.argv[2];
if (!folder) {
  console.error("usage: node harness.mjs <plugin-folder>");
  process.exit(1);
}

const main = fs.readFileSync(path.join(folder, "main.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8"));

// ---- Tracing proxy: any property access on an undefined-but-touched name
//      logs to `touched` and returns a permissive proxy/stub.

const touched = new Map(); // name -> count
function touch(name) {
  touched.set(name, (touched.get(name) ?? 0) + 1);
}

function makeStubFn(label) {
  const fn = function (...args) {
    touch(`call:${label}`);
    return makeProxy(`${label}()`);
  };
  return fn;
}

function makeProxy(label) {
  const target = function () {};
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => `[proxy ${label}]`;
      if (prop === "then") return undefined; // not a thenable
      if (prop === Symbol.iterator) return undefined;
      if (typeof prop === "symbol") return undefined;
      touch(`get:${label}.${String(prop)}`);
      return makeStubFn(`${label}.${String(prop)}`);
    },
    apply() {
      touch(`call:${label}`);
      return makeProxy(`${label}()`);
    },
    construct() {
      touch(`new:${label}`);
      return makeProxy(`new ${label}()`);
    },
  });
}

// ---- Minimal real-API shim (mirroring obsidianPluginWorker.ts) ----

class Notice {
  constructor(msg) {
    touch("Notice");
    console.log("[notice]", String(msg ?? ""));
  }
  setMessage(m) { touch("Notice.setMessage"); console.log("[notice]", m); return this; }
  hide() {}
}

class Component {
  _children = [];
  load() {
    if (typeof this.onload === "function") this.onload();
  }
  unload() {
    for (const c of this._children) c.unload();
    if (typeof this.onunload === "function") this.onunload();
  }
  addChild(c) { this._children.push(c); c.load(); return c; }
  removeChild(c) { this._children = this._children.filter(x => x !== c); c.unload(); return c; }
  register() {}
  registerEvent() {}
  registerDomEvent() {}
  registerInterval(id) { return id; }
}

class Plugin extends Component {
  app; manifest; _commands = [];
  constructor(app, m) { super(); this.app = app; this.manifest = m; }
  addCommand(c) {
    touch("Plugin.addCommand");
    this._commands.push(c);
    console.log("[command]", c.id, "-", c.name);
    return c;
  }
  addRibbonIcon(icon, title) { touch("Plugin.addRibbonIcon"); return { id: `rib-${title}` }; }
  addStatusBarItem() { touch("Plugin.addStatusBarItem"); return { setText() {}, remove() {} }; }
  addSettingTab(tab) { touch("Plugin.addSettingTab"); this._settingTab = tab; }
  async loadData() { touch("Plugin.loadData"); return null; }
  async saveData() { touch("Plugin.saveData"); }
  registerView() { touch("Plugin.registerView"); }
  registerExtensions() {}
  registerMarkdownPostProcessor() {}
  registerEditorExtension() {}
}

class Modal { app; constructor(a) { this.app = a; this.contentEl = makeProxy("Modal.contentEl"); } open() {} close() {} onOpen() {} onClose() {} }
class Setting {
  constructor() {}
  setName() { return this; } setDesc() { return this; }
  addText(cb) { cb({ setValue: () => this, onChange: () => this, setPlaceholder: () => this, inputEl: makeProxy("Setting.text.inputEl") }); return this; }
  addTextArea(cb) { cb({ setValue: () => this, onChange: () => this, setPlaceholder: () => this, inputEl: makeProxy("Setting.textarea.inputEl") }); return this; }
  addToggle(cb) { cb({ setValue: () => this, onChange: () => this }); return this; }
  addDropdown(cb) { cb({ addOption: () => this, addOptions: () => this, setValue: () => this, onChange: () => this }); return this; }
  addButton(cb) { cb({ setButtonText: () => this, onClick: () => this, setCta: () => this }); return this; }
  addSlider(cb) { cb({ setLimits: () => this, setValue: () => this, setDynamicTooltip: () => this, onChange: () => this }); return this; }
}
class PluginSettingTab {
  constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = makeProxy("PluginSettingTab.containerEl"); }
  display() {} hide() {}
}

class VaultAdapter {
  async read(p) { touch("Vault.adapter.read"); return ""; }
  async write(p, d) { touch("Vault.adapter.write"); }
  async exists() { touch("Vault.adapter.exists"); return false; }
  async list() { touch("Vault.adapter.list"); return { files: [], folders: [] }; }
  async mkdir() {}
  async remove() { throw new Error("vault remove unsupported"); }
}
class Vault {
  adapter = new VaultAdapter();
  async read() { touch("Vault.read"); return ""; }
  async modify() { touch("Vault.modify"); }
  async create(p) { touch("Vault.create"); return { path: p }; }
  getAbstractFileByPath(p) { touch("Vault.getAbstractFileByPath"); return { path: p }; }
  getFiles() { touch("Vault.getFiles"); return []; }
  on() { return { unsubscribe() {} }; }
}
class Workspace {
  getActiveFile() { touch("Workspace.getActiveFile"); return null; }
  getActiveViewOfType() { touch("Workspace.getActiveViewOfType"); return null; }
  on() { return { unsubscribe() {} }; }
  off() {}
  trigger() {}
  iterateAllLeaves() {}
  getLeaf() { touch("Workspace.getLeaf"); return makeProxy("Leaf"); }
  getLeftLeaf() { return makeProxy("LeftLeaf"); }
  getRightLeaf() { return makeProxy("RightLeaf"); }
  getLeavesOfType() { return []; }
  revealLeaf() {}
  detachLeavesOfType() {}
  ensureSideLeaf() {}
  registerHoverLinkSource() { touch("Workspace.registerHoverLinkSource"); }
  unregisterHoverLinkSource() {}
}
class App {
  vault = new Vault();
  workspace = new Workspace();
  metadataCache = {
    getFileCache: () => { touch("metadataCache.getFileCache"); return null; },
    getCache: () => null,
    getFirstLinkpathDest: () => { touch("metadataCache.getFirstLinkpathDest"); return null; },
    on() { return { unsubscribe() {} }; },
  };
  fileManager = {
    renameFile: () => { touch("fileManager.renameFile"); throw new Error("fileManager.renameFile not implemented"); },
    generateMarkdownLink: (...args) => { touch("fileManager.generateMarkdownLink"); return ""; },
  };
  keymap = { pushScope() {}, popScope() {} };
  scope = { register() {}, unregister() {} };
  internalPlugins = {
    getEnabledPluginById: () => null,
    getPluginById: () => null,
    plugins: {},
  };
  dragManager = { dragFile: () => null, onDragStart: () => {} };
}

const obsidian = {
  Plugin, Component, Notice, Modal, Setting, PluginSettingTab,
  App, Vault, Workspace,
  TFile: class { constructor(p = "") { this.path = p; } },
  TFolder: class {},
  MarkdownView: class {},
  Editor: class {},
  WorkspaceLeaf: class {},
  View: class { constructor() { throw new Error("View not supported"); } },
  ItemView: class { constructor() { throw new Error("ItemView not supported"); } },
  Menu: class {
    items = [];
    addItem(cb) { const it = { setTitle: () => it, setIcon: () => it, setSection: () => it, onClick: () => it }; cb(it); this.items.push(it); return this; }
    addSeparator() { return this; }
    showAtPosition() {}
    showAtMouseEvent() {}
    hide() {}
  },
  Keymap: { isModEvent: () => false, isModifier: () => false },
  Scope: class { register() { return {}; } unregister() {} },
  Platform: { isDesktop: true, isMobile: false, isMobileApp: false },
  addIcon: () => {},
  setIcon: () => {},
  setTooltip: () => {},
  debounce: (fn, wait = 0) => {
    let t = null;
    const d = (...a) => { if (t) clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, wait); };
    d.cancel = () => { if (t) { clearTimeout(t); t = null; } };
    return d;
  },
  normalizePath: (p) => p,
  requestUrl: async () => ({ status: 0, headers: {}, text: "", json: null, arrayBuffer: new ArrayBuffer(0) }),
};

// Wrap the module in a tracing proxy so any property the plugin reads that
// we DIDN'T export gets logged.
const tracedObsidian = new Proxy(obsidian, {
  get(t, prop) {
    if (prop in t) return t[prop];
    if (typeof prop === "symbol") return undefined;
    touch(`MISSING:obsidian.${String(prop)}`);
    return makeProxy(`obsidian.${String(prop)}`);
  },
});

function requireFn(name) {
  if (name === "obsidian") return tracedObsidian;
  touch(`MISSING:require("${name}")`);
  return makeProxy(`require(${name})`);
}

// ---- Run the bundle in a vm context, just like the worker's `new Function`
const sandbox = {
  module: { exports: {} },
  exports: {},
  require: requireFn,
  console,
  globalThis: undefined,
  window: makeProxy("window"),
  document: makeProxy("document"),
  navigator: makeProxy("navigator"),
  setTimeout, clearTimeout, setInterval, clearInterval,
  Buffer,
  process: { platform: process.platform, env: {} },
};
sandbox.module.exports = sandbox.exports;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

const ctx = vm.createContext(sandbox);

console.log(`\n========= ${manifest.name} (${manifest.id} @ ${manifest.version}) =========\n`);

let exported;
try {
  vm.runInContext(
    `(function(module, exports, require){\n${main}\n})(module, exports, require);`,
    ctx,
    { filename: `${manifest.id}/main.js`, timeout: 5000 },
  );
  exported = sandbox.module.exports;
  console.log("[evaluation] bundle evaluated, exports keys:", Object.keys(exported));
} catch (e) {
  console.error("[evaluation] CRASHED:", e?.message);
  console.error(String(e?.stack ?? "").split("\n").slice(0, 6).join("\n"));
  printTouched();
  process.exit(2);
}

function printTouched() {
  console.log("\n--- API surface touched during evaluation ---");
  const rows = [...touched.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [k, v] of rows) console.log(`  ${String(v).padStart(4)}  ${k}`);
}

const PluginClass =
  exported.default ??
  Object.values(exported).find(
    (v) => typeof v === "function" && (v === Plugin || isSubclass(v, Plugin)),
  ) ??
  exported;

function isSubclass(fn, base) {
  let p = Object.getPrototypeOf(fn);
  while (p) { if (p === base) return true; p = Object.getPrototypeOf(p); }
  return false;
}

if (typeof PluginClass !== "function") {
  console.error("[instantiate] no Plugin class exported, exports =", Object.keys(exported));
  printTouched();
  process.exit(3);
}

let instance;
try {
  instance = new PluginClass(new App(), manifest);
  console.log("[instantiate] OK:", PluginClass.name);
} catch (e) {
  console.error("[instantiate] CRASHED:", e?.message);
  console.error(String(e?.stack ?? "").split("\n").slice(0, 6).join("\n"));
  printTouched();
  process.exit(4);
}

try {
  await Promise.resolve(instance.load());
  console.log("[onload] completed without throwing");
} catch (e) {
  console.error("[onload] CRASHED:", e?.message);
  console.error(String(e?.stack ?? "").split("\n").slice(0, 6).join("\n"));
}

printTouched();
