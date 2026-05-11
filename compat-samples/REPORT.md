# Obsidian Plugin Compatibility Report

_Run against the 全视维 Obsidian shim in [src/plugins/obsidianPluginWorker.ts](../src/plugins/obsidianPluginWorker.ts) at HEAD `415d88c`._

## Test samples

| Plugin | Version | Bundle | Source |
| --- | --- | ---: | --- |
| **Recent Files** (`recent-files-obsidian`) | 1.7.7 | 53.2 KiB | https://github.com/tgrosinger/recent-files-obsidian/releases/tag/1.7.7 |
| **QuickAdd** (`quickadd`) | 2.12.0 | 4164.9 KiB | https://github.com/chhoumann/quickadd/releases/tag/2.12.0 |

## How we tested

Two passes:

1. **Static scan** — [`compat-samples/analyze.mjs`](analyze.mjs) word-matches the bundled `main.js` against three buckets derived from the shim source: `SUPPORTED` (real implementation), `STUBBED` (no-op / partial), `MISSING` (not exported at all).
2. **Live load** — [`compat-samples/harness.mjs`](harness.mjs) replays the shim's Web-Worker CommonJS host inside a Node `vm` context, then constructs the exported plugin class and calls `load()` while tracing every read on the `obsidian` module via `Proxy`. The Node harness is intentionally more permissive than the worker (missing exports return a stub proxy instead of `undefined`) so we can see how far an Obsidian plugin gets before it hits a *type* error rather than a *missing-export* error.

## Live-load verdicts

### 🟡 Recent Files — loads, dies in `onload`

```
[evaluation] bundle evaluated, exports keys: [ 'default' ]
[instantiate] OK: M
Recent Files: Loading plugin v1.7.7
[command] recent-files-open - Open
TypeError: this.app.workspace.registerHoverLinkSource is not a function
    at M.onload (recent-files-obsidian/main.js:7:8981)
```

- Bundle evaluation: ✅
- Plugin class detected (`module.exports.default`): ✅
- Constructor: ✅
- `loadData` round-trip: ✅ (called once)
- `addCommand` registered "recent-files-open": ✅
- **Crash point:** `this.app.workspace.registerHoverLinkSource(...)` — our `Workspace` shim doesn't expose this API.
- Also touched but tolerated (because the harness handed back proxy stubs): `obsidian.ItemView`, `obsidian.addIcon`, `obsidian.setIcon`, `obsidian.Keymap`, `obsidian.Menu` — under the *real* worker shim these are `undefined` and would crash much sooner (e.g. `class extends l.ItemView` → `Class extends value undefined is not a constructor or null`).

### 🔴 QuickAdd — dies during bundle evaluation

```
[evaluation] CRASHED: Cannot read properties of undefined (reading 'add')
    at quickadd/main.js:23
```

- 4 MiB Svelte bundle with extensive global setup (`window.__svelte`, Svelte component registry, dataview parser). Crashes at top level, long before `Plugin.onload` is reached.
- Will require a much richer DOM + window shim before it can even be evaluated. Not feasible to support QuickAdd from the Web Worker sandbox.

## Static scan summary

| Plugin | ✅ supported | ⚠️ stubbed | ❌ missing |
| --- | ---: | ---: | ---: |
| QuickAdd | 20 | 24 | 15 |
| Recent Files | 9 | 15 | 5 |

> ⚠️ Count-only — many "supported" hits in QuickAdd are false positives from generic JS names (`create`, `list`, `read`, `modify` collide with `Object.create`, array methods, etc.). The live-load result is the source of truth for what actually executes.

Top distinct unsupported APIs hit across both samples (deduplicated):

| API | Where | Severity for a typical plugin |
| --- | --- | --- |
| `addIcon` / `setIcon` | both | High — used by anything with a ribbon, status bar, or menu |
| `ItemView` / `View` | recent-files | High — required for any plugin that adds a side panel / leaf |
| `Menu` / `MenuItem` | both | High — context menus and file-menus |
| `Keymap` | recent-files | Medium — modifier-key detection on click |
| `Workspace.registerHoverLinkSource` | recent-files | Medium — hover-card integration |
| `Vault.getFileByPath` | recent-files | Medium — vault-level path lookup |
| `app.internalPlugins` / `app.dragManager` | recent-files | High — internal Obsidian state, no analogue |
| `MarkdownRenderer` / `htmlToMarkdown` | quickadd | High — needs markdown engine |
| `FuzzySuggestModal` / `SuggestModal` | quickadd | High — UI primitive on top of DOM |
| `TextComponent` / `ButtonComponent` / `ToggleComponent` / `DropdownComponent` | quickadd | High — settings UI primitives |
| `moment` / `debounce` | quickadd | Low — easy to ship as inline helpers |
| `obsidian.Scope` | quickadd | Low — keymap scope object, can be a no-op class |

## Prioritized shim additions

Sorted by `(plugin breakage frequency) × (implementation cost)`:

1. **Quick wins (1 line each, just stop the crash)** — `Workspace.registerHoverLinkSource` / `Workspace.unregisterHoverLinkSource`, `Workspace.trigger`, `Workspace.detachLeavesOfType`, `Workspace.getLeftLeaf` / `getRightLeaf` / `getLeaf` / `getLeavesOfType`, `Workspace.revealLeaf`, `Workspace.ensureSideLeaf`, `Vault.getFileByPath`, `App.internalPlugins.getEnabledPluginById`, `obsidian.debounce`, `obsidian.Scope`, `obsidian.Keymap.isModEvent`.
2. **Worth a real implementation** — `addIcon` / `setIcon` (map to a small built-in icon set; bridge to the host via a new RPC `setIcon(el, name)` once we can pass DOM handles), `MarkdownRenderer.renderMarkdown` (route through 全视维's existing markdown engine), `Vault.getFiles` (return the real page list).
3. **Cap with a "graceful error"** — `ItemView` / `View`: replace the silent `undefined` with a real class that throws a clearly-labelled error from its constructor (`"obsidian shim: ItemView is not supported in this sandbox"`), so plugins fail fast at registration time rather than producing the cryptic "Class extends value undefined is not a constructor" message.
4. **Out of scope for the worker sandbox** — anything DOM-heavy (`Modal` rendering, `Setting.addText` actually drawing inputs, Svelte global setup, CodeMirror integration). These would require running the plugin in a real renderer process with access to the document, not a Web Worker.

## What this confirms about the architecture

- The **Web Worker + CommonJS host** approach is good enough for *headless utility plugins* (a `Plugin` subclass that registers commands, ribbon icons, and uses `Vault`/`Workspace`). With the quick wins above, plugins like Recent Files should reach `onload` completion — they still won't render their view, but their commands and event listeners will register.
- The approach is **not** viable for plugins that bundle Svelte/React/CodeMirror and ship a full UI. QuickAdd is in this category. Supporting those would require a different sandbox (e.g. an iframe with a structured-clone bridge) — a separate workstream.
- The trade-off is consistent with what we promised in the bundled-plugins UI: 全视维 first-party plugins get a `kind: "native"` worker with full RPC access; Obsidian community plugins get a best-effort `kind: "obsidian"` worker with the limitations documented here.

## Reproducing this report

```powershell
cd d:\全视维\logseq-rs
node .\compat-samples\analyze.mjs .\compat-samples\quickadd .\compat-samples\recent-files
node .\compat-samples\harness.mjs .\compat-samples\recent-files
node .\compat-samples\harness.mjs .\compat-samples\quickadd
```

The sample bundles under `compat-samples/quickadd/` and `compat-samples/recent-files/` are unmodified release artefacts from the upstream GitHub releases linked at the top of this document.
