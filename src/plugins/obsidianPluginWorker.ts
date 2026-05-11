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

// SuggestModal / FuzzySuggestModal — Obsidian's command-palette-style picker.
// Plugins typically subclass these and override `getItems`, `getItemText`,
// `renderSuggestion`, `onChooseItem` / `onChooseSuggestion`. The real version
// pops a DOM input and lets the user pick interactively; in this worker we
// can't render one, but we *can* still let subclasses register and expose
// a `submit(query)` helper that fuzzy-matches against `getItems()` and runs
// `onChooseSuggestion` / `onChooseItem` with the best hit. The host can drive
// it via a command (e.g. `/jump` style), which is good enough for plugins
// that use the modal as a quick-action gate.

interface SuggestModalLike<T> {
  app: App;
  getItems(): T[] | Promise<T[]>;
  getItemText(item: T): string;
  renderSuggestion?(item: T, el: unknown): void;
  onChooseSuggestion?(item: T, evt: unknown): void;
  onChooseItem?(item: T, evt: unknown): void;
  inputEl?: { value: string };
}

function fuzzyScore(q: string, s: string): number {
  if (!q) return 1;
  const target = s.toLowerCase();
  const needle = q.toLowerCase();
  let ti = 0;
  let consecutive = 0;
  let score = 0;
  for (let ni = 0; ni < needle.length; ni++) {
    const c = needle[ni];
    let found = -1;
    for (let i = ti; i < target.length; i++) {
      if (target[i] === c) {
        found = i;
        break;
      }
    }
    if (found === -1) return 0;
    consecutive = found === ti ? consecutive + 1 : 1;
    score += 1 + consecutive * 2;
    ti = found + 1;
  }
  // bonus for shorter targets (prefer "todo" over "todo-list-archived")
  return score + Math.max(0, 30 - target.length) / 10;
}

class SuggestModal<T> extends Modal {
  inputEl: { value: string } = { value: "" };
  limit = 50;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getItems(): T[] | Promise<T[]> {
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getItemText(_item: T): string {
    return "";
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getSuggestions(query: string): T[] | Promise<T[]> {
    const self = this as unknown as SuggestModalLike<T>;
    const items = self.getItems();
    const pick = (list: T[]): T[] => {
      const q = String(query ?? "").trim();
      if (!q) return list.slice(0, this.limit);
      const scored = list
        .map((it) => ({ it, s: fuzzyScore(q, self.getItemText(it)) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, this.limit)
        .map((x) => x.it);
      return scored;
    };
    return items instanceof Promise ? items.then(pick) : pick(items as T[]);
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  renderSuggestion(_item: T, _el: unknown): void {
    /* no DOM */
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onChooseSuggestion(_item: T, _evt: unknown): void {
    /* override in subclass */
  }
  setPlaceholder(_p: string) {
    /* no-op */
  }
  setInstructions(_i: unknown) {
    /* no-op */
  }
  // Host-driver entry point — not in the real Obsidian API. The host calls
  // this through a command to drive the picker without a DOM. Returns the
  // chosen item (or null if no match) so callers can await it.
  async submit(query: string): Promise<T | null> {
    this.inputEl.value = query;
    const list = await Promise.resolve(this.getSuggestions(query));
    const top = (list as T[])[0];
    if (top === undefined) {
      notify(`(SuggestModal) 没有匹配：${query}`);
      return null;
    }
    try {
      this.onChooseSuggestion(top, { type: "host-submit", query });
    } catch (e) {
      notify(`(SuggestModal) onChooseSuggestion 抛错：${String((e as Error).message ?? e)}`);
    }
    return top;
  }
}

class FuzzySuggestModal<T> extends SuggestModal<T> {
  // Real Obsidian: `onChooseItem(item, evt)` is the override target for
  // FuzzySuggestModal; SuggestModal uses `onChooseSuggestion`. Bridge the
  // two so subclasses overriding either one work.
  onChooseSuggestion(item: T, evt: unknown): void {
    const self = this as unknown as SuggestModalLike<T>;
    if (typeof self.onChooseItem === "function") {
      self.onChooseItem(item, evt);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onChooseItem(_item: T, _evt: unknown): void {
    /* override in subclass */
  }
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

// ---------- icon registry ----------
//
// `addIcon(name, svgBody)` is the documented Obsidian API; `svgBody` is the
// inner SVG markup (paths/groups) without the outer <svg> wrapper. We keep a
// registry so `setIcon(el, name)` can later look the icon up. The registry is
// also consulted when ribbon/status entries are reported to the host so the
// 全视维 UI can choose to render the SVG instead of a placeholder glyph.
const iconRegistry = new Map<string, string>();

function wrapIconSvg(body: string): string {
  // Tolerate both bare inner markup and already-wrapped <svg>...</svg>.
  if (/^\s*<svg[\s>]/i.test(body)) return body;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="16" height="16">${body}</svg>`;
}

interface ElementLike {
  innerHTML?: string;
  textContent?: string | null;
  setText?: (t: string) => unknown;
  empty?: () => unknown;
}

function writeInto(el: unknown, html: string): boolean {
  if (!el || typeof el !== "object") return false;
  const e = el as ElementLike;
  try {
    if (typeof e.empty === "function") e.empty();
  } catch { /* ignore */ }
  if ("innerHTML" in e) {
    try {
      e.innerHTML = html;
      return true;
    } catch { /* fall through */ }
  }
  if (typeof e.setText === "function") {
    try {
      e.setText(html.replace(/<[^>]+>/g, ""));
      return true;
    } catch { /* fall through */ }
  }
  if ("textContent" in e) {
    try {
      e.textContent = html.replace(/<[^>]+>/g, "");
      return true;
    } catch { /* ignore */ }
  }
  return false;
}

// ---------- minimal Markdown renderer ----------
//
// The sandbox has no DOM, but plugins still call
// `MarkdownRenderer.renderMarkdown(md, el, sourcePath, component)` against
// elements they themselves built (e.g. inside a modal). To stay useful we
// implement a small, regex-based subset that covers the common cases:
// headings, **bold**, *italic*, `inline code`, fenced ``` blocks, links,
// bullet/numbered lists, blockquotes, hr, paragraphs, line breaks. This is
// not CommonMark-compliant; complex documents will render imperfectly.

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" :
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === '"' ? "&quot;" : "&#39;",
  );
}

function renderInline(s: string): string {
  let out = escapeHtml(s);
  // inline code first so its contents aren't re-processed
  const codes: string[] = [];
  out = out.replace(/`([^`\n]+)`/g, (_m, code) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // links [text](url) — only http/https/mailto are emitted as <a>
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, href: string) => {
    if (/^(https?:|mailto:)/i.test(href)) {
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    }
    return `<a>${text}</a>`;
  });
  // wiki links [[Page]] → plain link span (no real navigation in worker)
  out = out.replace(/\[\[([^\]]+)\]\]/g, (_m, name: string) => `<a class="wiki-link">${name}</a>`);
  // bold then italic
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  // restore code spans
  out = out.replace(/\u0000(\d+)\u0000/g, (_m, i) => codes[Number(i)] ?? "");
  return out;
}

function renderMarkdownToHtml(md: string): string {
  const src = md.replace(/\r\n?/g, "\n");
  const lines = src.split("\n");
  const out: string[] = [];
  let i = 0;
  let inList: "ul" | "ol" | null = null;
  const closeList = () => {
    if (inList) {
      out.push(`</${inList}>`);
      inList = null;
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    // fenced code
    const fence = /^```(\S*)\s*$/.exec(line);
    if (fence) {
      closeList();
      const lang = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // consume closing fence (may be EOF)
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      out.push(`<pre><code${cls}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const lvl = h[1].length;
      out.push(`<h${lvl}>${renderInline(h[2])}</h${lvl}>`);
      i++;
      continue;
    }
    // hr
    if (/^\s*(\*\s*){3,}\s*$/.test(line) || /^\s*(-\s*){3,}\s*$/.test(line)) {
      closeList();
      out.push("<hr/>");
      i++;
      continue;
    }
    // blockquote
    if (/^>\s?/.test(line)) {
      closeList();
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${renderInline(buf.join(" "))}</blockquote>`);
      continue;
    }
    // unordered list
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (ul) {
      if (inList !== "ul") {
        closeList();
        out.push("<ul>");
        inList = "ul";
      }
      out.push(`<li>${renderInline(ul[1])}</li>`);
      i++;
      continue;
    }
    // ordered list
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      if (inList !== "ol") {
        closeList();
        out.push("<ol>");
        inList = "ol";
      }
      out.push(`<li>${renderInline(ol[1])}</li>`);
      i++;
      continue;
    }
    // blank line
    if (/^\s*$/.test(line)) {
      closeList();
      i++;
      continue;
    }
    // paragraph: gather adjacent non-blank, non-block lines
    closeList();
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${renderInline(buf.join(" "))}</p>`);
  }
  closeList();
  return out.join("\n");
}

const obsidianModule = {
  Plugin,
  Component,
  Notice,
  Modal,
  SuggestModal,
  FuzzySuggestModal,
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
  TFolder: class {
    path: string;
    name: string;
    children: unknown[] = [];
    parent: unknown = null;
    constructor(path = "") {
      this.path = path;
      const idx = path.lastIndexOf("/");
      this.name = idx >= 0 ? path.slice(idx + 1) : path;
    }
  },
  // MarkdownView / Editor / WorkspaceLeaf — used by plugins to detect "am
  // I attached to a real editor?". We give them inert, well-shaped
  // instances so feature detection (`instanceof`, `view.editor`, etc.)
  // doesn't crash. None of these mutate any real document; writes happen
  // through `Vault.adapter` which is wired to the host.
  MarkdownView: class {
    file: unknown = null;
    editor: { getValue: () => string; setValue: (v: string) => void; replaceSelection: (s: string) => void; getCursor: () => { line: number; ch: number }; getSelection: () => string };
    constructor() {
      let buffer = "";
      this.editor = {
        getValue: () => buffer,
        setValue: (v: string) => {
          buffer = String(v ?? "");
        },
        replaceSelection: (s: string) => {
          buffer += String(s ?? "");
        },
        getCursor: () => ({ line: 0, ch: buffer.length }),
        getSelection: () => "",
      };
    }
    getViewType() {
      return "markdown";
    }
    getMode() {
      return "source";
    }
    getDisplayText() {
      return "";
    }
  },
  Editor: class {
    private _buf = "";
    getValue() {
      return this._buf;
    }
    setValue(v: string) {
      this._buf = String(v ?? "");
    }
    getLine(_n: number) {
      return this._buf.split("\n")[_n] ?? "";
    }
    lineCount() {
      return this._buf.split("\n").length;
    }
    getCursor() {
      return { line: 0, ch: this._buf.length };
    }
    setCursor(_pos: unknown) {
      /* no-op */
    }
    getSelection() {
      return "";
    }
    replaceSelection(s: string) {
      this._buf += String(s ?? "");
    }
    replaceRange(s: string, _from: unknown, _to?: unknown) {
      this._buf += String(s ?? "");
    }
    focus() {
      /* no-op */
    }
    blur() {
      /* no-op */
    }
    refresh() {
      /* no-op */
    }
    somethingSelected() {
      return false;
    }
  },
  WorkspaceLeaf: class {
    view: unknown = null;
    getViewState() {
      return { type: "empty", state: {} };
    }
    setViewState(_s: unknown) {
      return Promise.resolve();
    }
    detach() {
      /* no-op */
    }
    open(_v: unknown) {
      return Promise.resolve();
    }
    getDisplayText() {
      return "";
    }
    on(_e: string, _cb: (...a: unknown[]) => void) {
      return { id: "" };
    }
  },
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
  // Icon registry. `addIcon` stores the SVG body; `setIcon` looks it up and
  // writes the wrapped <svg> into el.innerHTML when the target element
  // supports it (e.g. a host-provided element, or a worker-side fake with
  // innerHTML).  Unknown icon names emit a placeholder so callers can still
  // see *something*.
  addIcon: (name: string, svg: string) => {
    if (typeof name === "string" && typeof svg === "string") {
      iconRegistry.set(name, svg);
    }
  },
  setIcon: (el: unknown, name: string) => {
    const raw = iconRegistry.get(String(name));
    if (raw !== undefined) {
      writeInto(el, wrapIconSvg(raw));
      return;
    }
    // unknown icon: emit a placeholder square so the slot is at least visible
    writeInto(
      el,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="16" height="16"><rect x="10" y="10" width="80" height="80" fill="none" stroke="currentColor" stroke-width="8"/></svg>`,
    );
  },
  getIconIds: () => Array.from(iconRegistry.keys()),
  // MarkdownRenderer — exposes a regex-based renderer that writes HTML into
  // a caller-provided element. The 4th argument (`component`) is accepted
  // for API compatibility but ignored.
  MarkdownRenderer: class {
    static async renderMarkdown(md: string, el: unknown, _sourcePath?: string, _component?: unknown) {
      writeInto(el, renderMarkdownToHtml(String(md ?? "")));
    }
    static async render(_app: unknown, md: string, el: unknown, _sourcePath?: string, _component?: unknown) {
      writeInto(el, renderMarkdownToHtml(String(md ?? "")));
    }
    static renderMarkdownSync(md: string, el: unknown) {
      writeInto(el, renderMarkdownToHtml(String(md ?? "")));
    }
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
