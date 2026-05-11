/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */
//
// Obsidian compatibility worker — best-effort.
//
// Runs a CommonJS-style Obsidian plugin bundle (typically `main.js` produced
// by esbuild/rollup with `format=cjs` and `external: ["obsidian"]`) inside
// its own Web Worker. Exposes a *minimal subset* of the `obsidian` module
// expected by simple, headless plugins. The shim is NOT a full Obsidian
// replacement — pluginsthat touch CodeMirror, the DOM, MarkdownView, or
// advanced Workspace APIs will either silently no-op or throw a clearly
// labelled "obsidian shim: not implemented" error in the host console.
//
// What works:
//   - `Plugin` lifecycle (`onload`, `onunload`)
//   - `addCommand({ id, name, callback })` — surfaces in 全视维 command palette
//   - `new Notice("message")` — surfaces as a toast
//   - `this.app.vault.adapter.read/write` against a virtual journal/page tree
//   - `addRibbonIcon` / `addStatusBarItem` — registered but never rendered
//
// Anything else returns `undefined` or throws a tagged error.
//

export {};

declare const self: DedicatedWorkerGlobalScope;

interface HostReply {
  __rs_rpc: true;
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

interface HostEvent {
  __rs_event: true;
  name: string;
  payload: unknown;
}

let rpcSeq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

function rpc<T>(method: string, args: unknown[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++rpcSeq;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    self.postMessage({ __rs_rpc: true, id, method, args });
  });
}

const commandHandlers = new Map<string, () => unknown | Promise<unknown>>();
const eventHandlers = new Map<string, Array<(payload: unknown) => void>>();
const ribbon: { id: string; icon: string; title: string }[] = [];
const statusItems: { id: string; text: string }[] = [];

function notify(message: string) {
  self.postMessage({ __rs_notify: true, message });
}

function notImplemented(name: string) {
  return () => {
    throw new Error(`obsidian shim: ${name} not implemented`);
  };
}

// ---------- obsidian module ----------

class Notice {
  constructor(message: string, _timeout?: number) {
    notify(String(message ?? ""));
  }
  setMessage(msg: string) {
    notify(String(msg ?? ""));
    return this;
  }
  hide() {
    /* no-op */
  }
}

class Component {
  _children: Component[] = [];
  load() {
    if (typeof (this as unknown as { onload?: () => void }).onload === "function") {
      (this as unknown as { onload: () => void }).onload();
    }
  }
  unload() {
    for (const c of this._children) c.unload();
    if (typeof (this as unknown as { onunload?: () => void }).onunload === "function") {
      (this as unknown as { onunload: () => void }).onunload();
    }
  }
  addChild<T extends Component>(c: T): T {
    this._children.push(c);
    c.load();
    return c;
  }
  removeChild<T extends Component>(c: T): T {
    this._children = this._children.filter((x) => x !== c);
    c.unload();
    return c;
  }
  register(_cb: () => void) {
    /* best-effort: ignored on unload */
  }
  registerEvent(_evt: unknown) {
    /* ignored */
  }
  registerDomEvent(..._args: unknown[]) {
    /* DOM not available in worker */
  }
  registerInterval(id: number) {
    return id;
  }
}

interface PluginCommand {
  id: string;
  name: string;
  callback?: () => unknown | Promise<unknown>;
  editorCallback?: (...args: unknown[]) => unknown | Promise<unknown>;
}

class VaultAdapter {
  async read(path: string): Promise<string> {
    // Map "<page>.md" to a page name; otherwise raise.
    const m = /^(.*?)(?:\.md)?$/i.exec(path);
    const name = (m?.[1] ?? path).toLowerCase();
    const page = await rpc<{ id: string; root_block_ids: string[] } | null>(
      "getPage",
      [name],
    );
    if (!page) throw new Error(`vault: not found: ${path}`);
    const lines: string[] = [];
    for (const blockId of page.root_block_ids) {
      const block = await rpc<{ content: string } | null>("getBlock", [blockId]);
      if (block) lines.push(block.content);
    }
    return lines.join("\n\n");
  }
  async write(path: string, data: string): Promise<void> {
    const m = /^(.*?)(?:\.md)?$/i.exec(path);
    const name = m?.[1] ?? path;
    await rpc<unknown>("obsidianWritePage", [name, data]);
  }
  async exists(path: string): Promise<boolean> {
    try {
      await this.read(path);
      return true;
    } catch {
      return false;
    }
  }
  async list(_path: string): Promise<{ files: string[]; folders: string[] }> {
    const pages = await rpc<Array<{ name: string }>>("listPages");
    return {
      files: pages.map((p) => `${p.name}.md`),
      folders: [],
    };
  }
  async mkdir(_path: string) {
    /* journals + pages have no folder structure */
  }
  async remove(_path: string) {
    throw new Error("obsidian shim: vault remove not supported");
  }
}

class Vault {
  adapter = new VaultAdapter();
  async read(file: { path: string } | string): Promise<string> {
    return this.adapter.read(typeof file === "string" ? file : file.path);
  }
  async modify(file: { path: string } | string, data: string): Promise<void> {
    return this.adapter.write(typeof file === "string" ? file : file.path, data);
  }
  async create(path: string, data: string): Promise<{ path: string }> {
    await this.adapter.write(path, data);
    return { path };
  }
  getAbstractFileByPath(path: string) {
    return { path };
  }
  getFileByPath(path: string) {
    // Obsidian's newer API; alias of getAbstractFileByPath for our purposes.
    return { path, name: path.split("/").pop() ?? path, basename: (path.split("/").pop() ?? path).replace(/\.[^/.]+$/, ""), extension: (path.match(/\.([^.]+)$/)?.[1] ?? "") };
  }
  getFiles() {
    return [] as { path: string }[];
  }
  on(_evt: string, _cb: unknown) {
    /* event subscription not wired */
    return { unsubscribe() {} };
  }
  off(_evt: string, _cb: unknown) {
    /* no-op — event system is not wired */
  }
}

// A tiny stub leaf — methods return permissive defaults so plugin code that
// chains `.openFile()`, `.setViewState()`, etc. doesn't crash. View rendering
// is still not implemented; the leaf exists only to satisfy type contracts.
function makeLeafStub(): Record<string, (...args: unknown[]) => unknown> {
  const leaf: Record<string, (...args: unknown[]) => unknown> = {};
  const methods = ["openFile", "setViewState", "getViewState", "detach", "on", "off"];
  for (const m of methods) leaf[m] = () => undefined;
  leaf.view = (() => null) as never;
  return leaf;
}

class Workspace {
  async getActiveFile(): Promise<{ path: string } | null> {
    const page = await rpc<{ name: string } | null>("getCurrentPage");
    if (!page) return null;
    return { path: `${page.name}.md` };
  }
  async getActiveViewOfType<T>(_type: unknown): Promise<T | null> {
    return null;
  }
  on(_evt: string, _cb: unknown) {
    return { unsubscribe() {} };
  }
  off(_evt: string, _cb: unknown) {
    /* no-op */
  }
  trigger(_evt: string, ..._args: unknown[]) {
    /* event broadcast not wired */
  }
  iterateAllLeaves(_cb: unknown) {
    /* no leaves */
  }
  // --- leaf accessors (all return inert stubs) ---
  getLeaf(_newLeaf?: boolean | string) {
    return makeLeafStub();
  }
  getLeftLeaf(_split?: boolean) {
    return makeLeafStub();
  }
  getRightLeaf(_split?: boolean) {
    return makeLeafStub();
  }
  getLeavesOfType(_type: string) {
    return [] as ReturnType<typeof makeLeafStub>[];
  }
  getMostRecentLeaf() {
    return makeLeafStub();
  }
  revealLeaf(_leaf: unknown) {
    /* no-op */
  }
  detachLeavesOfType(_type: string) {
    /* no-op */
  }
  ensureSideLeaf(_type: string, _side: string, _opts?: unknown) {
    /* no-op */
  }
  // --- hover-link source registry (used by Recent Files, file-explorer, etc.) ---
  registerHoverLinkSource(_id: string, _info: unknown) {
    /* no-op */
  }
  unregisterHoverLinkSource(_id: string) {
    /* no-op */
  }
}

class App {
  vault = new Vault();
  workspace = new Workspace();
  metadataCache = {
    getFileCache: () => null,
    getCache: () => null,
    getFirstLinkpathDest: () => null,
    on() {
      return { unsubscribe() {} };
    },
  };
  fileManager = {
    renameFile: notImplemented("fileManager.renameFile"),
    generateMarkdownLink: (_file: unknown, _sourcePath: string, _subpath?: string, _alias?: string) => "",
  };
  keymap = { pushScope: () => {}, popScope: () => {} };
  scope = { register: () => {}, unregister: () => {} };
  // Plugins like Recent Files probe `app.internalPlugins` to check whether
  // the built-in Bookmarks plugin is enabled. We answer "not enabled".
  internalPlugins = {
    getEnabledPluginById: (_id: string) => null,
    getPluginById: (_id: string) => null,
    plugins: {},
  };
  // dragManager is touched by drag-and-drop code paths; we stub it out so
  // event handlers don't crash before any drag actually occurs.
  dragManager = {
    dragFile: () => null,
    onDragStart: () => {},
  };
}

const sharedApp = new App();

class PluginSettingTab {
  app: App;
  plugin: Plugin;
  containerEl: { empty: () => void; createEl: () => unknown };
  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = { empty: () => {}, createEl: () => ({}) };
  }
  display() {
    /* DOM not available — subclasses override */
  }
  hide() {
    /* ignored */
  }
}

class Modal {
  app: App;
  contentEl: { empty: () => void; createEl: () => unknown };
  constructor(app: App) {
    this.app = app;
    this.contentEl = { empty: () => {}, createEl: () => ({}) };
  }
  open() {
    notify("(Obsidian modal opened — UI not rendered in this app)");
  }
  close() {
    /* no-op */
  }
  onOpen() {}
  onClose() {}
}

class Setting {
  constructor(_containerEl: unknown) {}
  setName(_n: string) {
    return this;
  }
  setDesc(_d: string) {
    return this;
  }
  addText(cb: (el: { setValue: (v: string) => unknown; onChange: (cb: (v: string) => void) => unknown; setPlaceholder: (p: string) => unknown; inputEl: Record<string, unknown> }) => void) {
    cb({
      setValue: () => this,
      onChange: () => this,
      setPlaceholder: () => this,
      inputEl: {},
    });
    return this;
  }
  addToggle(cb: (el: { setValue: (v: boolean) => unknown; onChange: (cb: (v: boolean) => void) => unknown }) => void) {
    cb({ setValue: () => this, onChange: () => this });
    return this;
  }
  addDropdown(cb: (el: { addOption: (k: string, v: string) => unknown; setValue: (v: string) => unknown; onChange: (cb: (v: string) => void) => unknown }) => void) {
    cb({ addOption: () => this, setValue: () => this, onChange: () => this });
    return this;
  }
  addButton(cb: (el: { setButtonText: (t: string) => unknown; onClick: (cb: () => void) => unknown }) => void) {
    cb({ setButtonText: () => this, onClick: () => this });
    return this;
  }
}

class Plugin extends Component {
  app: App;
  manifest: Record<string, unknown>;
  _commands: PluginCommand[] = [];
  _settingTab: PluginSettingTab | null = null;
  constructor(app: App, manifest: Record<string, unknown>) {
    super();
    this.app = app;
    this.manifest = manifest;
  }
  addCommand(cmd: PluginCommand) {
    this._commands.push(cmd);
    const exec = cmd.callback ?? (cmd.editorCallback as (() => unknown) | undefined);
    if (exec) commandHandlers.set(cmd.id, exec);
    self.postMessage({
      __rs_register: "command",
      id: cmd.id,
      label: cmd.name ?? cmd.id,
    });
    return cmd;
  }
  addRibbonIcon(icon: string, title: string, _cb: () => void) {
    const id = `ribbon-${ribbon.length}`;
    ribbon.push({ id, icon, title });
    return { id };
  }
  addStatusBarItem() {
    const id = `status-${statusItems.length}`;
    statusItems.push({ id, text: "" });
    return {
      setText(t: string) {
        const item = statusItems.find((s) => s.id === id);
        if (item) item.text = String(t ?? "");
      },
      remove() {},
    };
  }
  addSettingTab(tab: PluginSettingTab) {
    this._settingTab = tab;
  }
  async loadData(): Promise<unknown> {
    try {
      return await rpc<unknown>("obsidianLoadData");
    } catch {
      return null;
    }
  }
  async saveData(data: unknown): Promise<void> {
    await rpc<unknown>("obsidianSaveData", [data]);
  }
  registerView(_t: string, _factory: unknown) {
    /* views not supported */
  }
  registerExtensions(_exts: string[], _viewType: string) {
    /* ignored */
  }
  registerMarkdownPostProcessor(_p: unknown) {
    /* not rendered */
  }
  registerEditorExtension(_e: unknown) {
    /* not rendered */
  }
}

const obsidianModule = {
  Plugin,
  Component,
  Notice,
  Modal,
  Setting,
  PluginSettingTab,
  App,
  Vault,
  Workspace,
  // The Obsidian API also exposes constants/types — we re-export the names
  // most plugins probe for so feature-detection doesn't crash.
  TFile: class {
    path: string;
    name: string;
    constructor(path = "") {
      this.path = path;
      const idx = path.lastIndexOf("/");
      this.name = idx >= 0 ? path.slice(idx + 1) : path;
    }
  },
  TFolder: class {},
  MarkdownView: class {},
  Editor: class {},
  WorkspaceLeaf: class {},
  // View / ItemView throw a *clearly labelled* error instead of being
  // `undefined`. Plugins like Recent Files do `class b extends l.ItemView`
  // at module top level — if ItemView is missing, the cryptic
  // "Class extends value undefined is not a constructor or null" fires
  // before we can log anything useful.
  View: class {
    constructor() {
      throw new Error("obsidian shim: View is not supported in this sandbox");
    }
  },
  ItemView: class {
    constructor() {
      throw new Error("obsidian shim: ItemView is not supported in this sandbox");
    }
  },
  // Menu / MenuItem — context-menu primitives. Stub them as inert builders so
  // plugins can construct + populate them without crashing; they just won't
  // visually appear.
  Menu: class {
    items: unknown[] = [];
    addItem(cb: (item: { setTitle: (t: string) => unknown; setIcon: (i: string) => unknown; setSection: (s: string) => unknown; onClick: (cb: () => void) => unknown }) => void) {
      const item = {
        setTitle: () => item,
        setIcon: () => item,
        setSection: () => item,
        onClick: () => item,
      };
      cb(item);
      this.items.push(item);
      return this;
    }
    addSeparator() {
      return this;
    }
    showAtPosition(_pos: unknown) {
      /* DOM unavailable */
    }
    showAtMouseEvent(_e: unknown) {
      /* DOM unavailable */
    }
    hide() {
      /* no-op */
    }
  },
  // Keymap helpers — `isModEvent` is used by plugins to detect ctrl/cmd-click;
  // we conservatively return `false`.
  Keymap: {
    isModEvent: (_e: unknown) => false,
    isModifier: (_e: unknown, _mod: string) => false,
  },
  Scope: class {
    register() {
      return {} as { id: string };
    }
    unregister(_h: unknown) {
      /* no-op */
    }
  },
  Platform: { isDesktop: true, isMobile: false, isMobileApp: false },
  // Stubs for utility helpers some plugins import.
  addIcon: (_name: string, _svg: string) => {
    /* no DOM icon registry; recorded silently */
  },
  setIcon: (_el: unknown, _name: string) => {
    /* no DOM \u2014 plugins that rely on visual feedback are out of luck */
  },
  setTooltip: (_el: unknown, _text: string) => {
    /* no DOM */
  },
  debounce: <T extends (...args: unknown[]) => unknown>(fn: T, wait = 0, _immediate = false) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = (...args: Parameters<T>) => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn(...(args as unknown[]));
      }, wait);
    };
    (debounced as unknown as { cancel: () => void }).cancel = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    return debounced as unknown as T & { cancel: () => void };
  },
  normalizePath: (p: string) => p,
  requestUrl: async (opts: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => {
    const res = await rpc<{ status: number; headers: Record<string, string>; body: string }>("httpFetch", [
      opts.url,
      { method: opts.method ?? "GET", headers: opts.headers, body: opts.body },
    ]);
    let json: unknown = null;
    try {
      json = JSON.parse(res.body);
    } catch {
      /* not JSON */
    }
    return {
      status: res.status,
      headers: res.headers,
      text: res.body,
      json,
      arrayBuffer: new ArrayBuffer(0),
    };
  },
};

// ---------- minimal CommonJS host ----------

function requireFn(name: string): unknown {
  if (name === "obsidian") return obsidianModule;
  throw new Error(`obsidian shim: cannot require "${name}"`);
}

self.addEventListener("message", async (ev: MessageEvent) => {
  const data = ev.data as Record<string, unknown> | null;
  if (!data) return;

  if (data.type === "init") {
    const source = String(data.source ?? "");
    const manifest = (data.manifest ?? {}) as Record<string, unknown>;
    try {
      const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
      const exports = moduleObj.exports;
      // eslint-disable-next-line no-new-func
      const factory = new Function(
        "module",
        "exports",
        "require",
        "self",
        "window",
        `${source}\n//# sourceURL=obsidian-plugin://${manifest.id ?? "unknown"}`,
      );
      factory(moduleObj, exports, requireFn, self, self);

      const PluginClass = (moduleObj.exports as { default?: unknown }).default
        ?? Object.values(moduleObj.exports).find(
          (v) =>
            typeof v === "function" &&
            (Object.getPrototypeOf(v) === Plugin || v === Plugin || isPluginSubclass(v as Function)),
        )
        ?? moduleObj.exports;

      if (typeof PluginClass !== "function") {
        throw new Error("obsidian shim: plugin entry did not export a class");
      }
      const instance = new (PluginClass as new (app: App, manifest: unknown) => Plugin)(
        sharedApp,
        manifest,
      );
      await Promise.resolve(instance.load());
      self.postMessage({ __rs_ready: true });
    } catch (e) {
      self.postMessage({ __rs_error: String((e as Error)?.stack ?? e) });
    }
    return;
  }

  if (data.__rs_rpc) {
    const reply = data as unknown as HostReply;
    const p = pending.get(reply.id);
    if (!p) return;
    pending.delete(reply.id);
    if (reply.ok) p.resolve(reply.value);
    else p.reject(new Error(reply.error ?? "rpc error"));
    return;
  }

  if (data.__rs_event) {
    const evt = data as unknown as HostEvent;
    const handlers = eventHandlers.get(evt.name) ?? [];
    for (const h of handlers) {
      try {
        h(evt.payload);
      } catch (e) {
        console.error(`[obsidian-shim] event handler "${evt.name}" threw`, e);
      }
    }
    return;
  }

  if (data.__rs_invoke === "command") {
    const commandId = String(data.commandId ?? "");
    const h = commandHandlers.get(commandId);
    if (h) {
      try {
        await h();
      } catch (e) {
        console.error("[obsidian-shim] command failed", commandId, e);
      }
    }
  }
});

function isPluginSubclass(fn: Function): boolean {
  let proto = Object.getPrototypeOf(fn);
  while (proto) {
    if (proto === Plugin) return true;
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}
