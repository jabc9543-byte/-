// Static compatibility analyzer for Obsidian plugin bundles.
//
// Scans a `main.js` produced by esbuild/rollup with `external: ["obsidian"]`
// for references to known Obsidian API surface, then cross-references against
// the 全视维 Obsidian shim categories.
//
// Usage:  node analyze.mjs <plugin-folder> [<plugin-folder> ...]

import fs from "node:fs";
import path from "node:path";

// === Shim surface from src/plugins/obsidianPluginWorker.ts ============

// Fully implemented (at least the happy path returns sensible data).
const SUPPORTED = new Set([
  "Plugin",
  "Component",
  "Notice",
  "App",
  "Vault",
  "Workspace",
  "TFile",
  "TFolder",
  "Platform",
  "normalizePath",
  "requestUrl",
  // Plugin methods
  "addCommand",
  "addRibbonIcon",
  "addStatusBarItem",
  "addSettingTab",
  "loadData",
  "saveData",
  // Vault adapter happy path
  "adapter",
  "read",
  "modify",
  "create",
  "exists",
  "list",
  // Workspace
  "getActiveFile",
]);

// Stubbed: shim exists, but returns undefined/no-op/throws "not implemented".
const STUBBED = new Set([
  "Modal",
  "Setting",
  "PluginSettingTab",
  "MarkdownView",
  "Editor",
  "WorkspaceLeaf",
  "metadataCache",
  "fileManager",
  "renameFile",
  "registerView",
  "registerExtensions",
  "registerMarkdownPostProcessor",
  "registerEditorExtension",
  "registerDomEvent",
  "registerEvent",
  "registerInterval",
  "iterateAllLeaves",
  "getActiveViewOfType",
  "getFiles",
  "getAbstractFileByPath",
  "getFileCache",
  "containerEl",
  "contentEl",
  "scope",
  "keymap",
  "remove",
  "mkdir",
  // Setting builder methods are stubbed (no UI rendering)
  "addText",
  "addToggle",
  "addDropdown",
  "addButton",
  "setName",
  "setDesc",
]);

// Completely missing from the shim — accessing as a top-level obsidian export
// will return `undefined` and likely crash the plugin.
const MISSING = new Set([
  "MarkdownRenderer",
  "MarkdownRenderChild",
  "FuzzySuggestModal",
  "SuggestModal",
  "EditorSuggest",
  "addIcon",
  "setIcon",
  "FileSystemAdapter",
  "ItemView",
  "View",
  "Menu",
  "MenuItem",
  "Tasks",
  "TextComponent",
  "TextAreaComponent",
  "ButtonComponent",
  "ToggleComponent",
  "DropdownComponent",
  "SliderComponent",
  "ColorComponent",
  "ProgressBarComponent",
  "ExtraButtonComponent",
  "MomentFormatComponent",
  "SearchComponent",
  "Keymap",
  "Scope",
  "HoverParent",
  "HoverPopover",
  "PopoverState",
  "EditorPosition",
  "EditorRange",
  "EditorTransaction",
  "EditorSelection",
  "LivePreview",
  "Tasks",
  "debounce",
  "moment",
  "parseLinktext",
  "parseFrontMatterAliases",
  "parseFrontMatterEntry",
  "parseFrontMatterStringArray",
  "parseFrontMatterTags",
  "parseYaml",
  "stringifyYaml",
  "htmlToMarkdown",
  "loadMathJax",
  "loadPrism",
  "loadPdfJs",
  "renderResults",
  "sanitizeHTMLToDom",
  "arrayBufferToBase64",
  "base64ToArrayBuffer",
  "arrayBufferToHex",
  "hexToArrayBuffer",
  "resolveSubpath",
  "Tasks",
  "ViewState",
]);

// === Scanner =========================================================

function countWord(haystack, needle) {
  const re = new RegExp(`(?<![A-Za-z0-9_$])${needle}(?![A-Za-z0-9_$])`, "g");
  const matches = haystack.match(re);
  return matches ? matches.length : 0;
}

function snippet(text, needle) {
  const re = new RegExp(`(?<![A-Za-z0-9_$])${needle}(?![A-Za-z0-9_$])`);
  const m = re.exec(text);
  if (!m) return null;
  const start = Math.max(0, m.index - 40);
  const end = Math.min(text.length, m.index + 80);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function analyze(folder) {
  const mainPath = path.join(folder, "main.js");
  const manifestPath = path.join(folder, "manifest.json");
  const main = fs.readFileSync(mainPath, "utf8");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const seen = new Map(); // name -> count

  const all = new Set([...SUPPORTED, ...STUBBED, ...MISSING]);
  for (const name of all) {
    const c = countWord(main, name);
    if (c > 0) seen.set(name, c);
  }

  const supported = [];
  const stubbed = [];
  const missing = [];
  for (const [name, count] of seen) {
    const entry = { name, count, sample: snippet(main, name) };
    if (SUPPORTED.has(name)) supported.push(entry);
    else if (STUBBED.has(name)) stubbed.push(entry);
    else if (MISSING.has(name)) missing.push(entry);
  }
  const sortDesc = (a, b) => b.count - a.count || a.name.localeCompare(b.name);
  supported.sort(sortDesc);
  stubbed.sort(sortDesc);
  missing.sort(sortDesc);

  return {
    manifest,
    bytes: main.length,
    supported,
    stubbed,
    missing,
  };
}

function fmt(rows) {
  if (rows.length === 0) return "_(none)_\n";
  let out = "| API | Count | Sample |\n| --- | ---: | --- |\n";
  for (const r of rows) {
    const sample = (r.sample ?? "").replace(/\|/g, "\\|");
    out += `| \`${r.name}\` | ${r.count} | \`${sample.slice(0, 80)}\` |\n`;
  }
  return out;
}

const folders = process.argv.slice(2);
if (folders.length === 0) {
  console.error("usage: node analyze.mjs <folder> [<folder> ...]");
  process.exit(1);
}

let report = "# Obsidian Plugin Compatibility Report\n\n";
report += `_Generated against the 全视维 Obsidian shim in \`src/plugins/obsidianPluginWorker.ts\`._\n\n`;

const summary = [];
for (const folder of folders) {
  const r = analyze(folder);
  const id = r.manifest.id ?? path.basename(folder);
  const name = r.manifest.name ?? id;
  const version = r.manifest.version ?? "?";
  report += `## ${name} (\`${id}\` @ ${version})\n\n`;
  report += `- bundle size: ${(r.bytes / 1024).toFixed(1)} KiB\n`;
  report += `- declared in manifest: \`${JSON.stringify(r.manifest)}\`\n\n`;
  report += `### ✅ Supported APIs hit\n\n${fmt(r.supported)}\n`;
  report += `### ⚠️ Stubbed APIs hit (no-op / throws / partial)\n\n${fmt(r.stubbed)}\n`;
  report += `### ❌ Completely missing APIs hit\n\n${fmt(r.missing)}\n`;
  summary.push({
    id,
    name,
    supported: r.supported.length,
    stubbed: r.stubbed.length,
    missing: r.missing.length,
    verdict:
      r.missing.length === 0 && r.stubbed.length <= 3
        ? "🟢 likely loads"
        : r.missing.length <= 2
          ? "🟡 partial — settings UI and advanced features will fail"
          : "🔴 will fail at load / first command",
  });
}

report = report.replace(
  "_Generated against",
  "## Summary\n\n| Plugin | ✅ supported | ⚠️ stubbed | ❌ missing | Verdict |\n| --- | ---: | ---: | ---: | --- |\n"
    + summary
      .map((s) => `| ${s.name} | ${s.supported} | ${s.stubbed} | ${s.missing} | ${s.verdict} |`)
      .join("\n")
    + "\n\n_Generated against"
);

fs.writeFileSync(path.join(process.cwd(), "compat-samples", "REPORT.md"), report, "utf8");
console.log(report);
