import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { api } from "../api";
import { BUILTIN_MARKETPLACE } from "../plugins/builtinMarketplace";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore － Vite worker URL import.
import PluginWorker from "../plugins/pluginWorker.ts?worker&inline";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore － Vite worker URL import.
import ObsidianPluginWorker from "../plugins/obsidianPluginWorker.ts?worker&inline";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entry: string;
  permissions: string[];
  /** "native" (default) or "obsidian". */
  kind?: string;
  /** Category bucket shown in the in-app "插件广场". */
  category?: string;
  /** Emoji or short icon glyph shown on cards. */
  icon?: string;
  /** Optional homepage / repo URL. */
  homepage?: string;
  /** Optional short tagline shown beneath name. */
  tagline?: string;
}

export interface PluginEntry {
  manifest: PluginManifest;
  enabled: boolean;
  installed_at: string;
}

export interface PluginCommand {
  pluginId: string;
  id: string;
  label: string;
}

export interface PluginSlashCommand {
  pluginId: string;
  trigger: string;
  label: string;
}

export interface MarketplaceEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  homepage: string;
  tags: string[];
  download_url: string;
  sha256: string | null;
  permissions: string[];
}

export interface MarketplaceListing {
  source: string;
  entries: MarketplaceEntry[];
  fetched_at: string;
}

const REGISTRIES_KEY = "logseq-rs:marketplace-urls";

function loadRegistries(): string[] {
  try {
    const raw = localStorage.getItem(REGISTRIES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveRegistries(urls: string[]) {
  try {
    localStorage.setItem(REGISTRIES_KEY, JSON.stringify(urls));
  } catch {
    /* ignore */
  }
}

interface LivePlugin {
  entry: PluginEntry;
  worker: Worker;
  ready: boolean;
}

export interface PluginPromptRequest {
  id: number;
  pluginId: string;
  message: string;
  default: string;
}

export interface PluginAlertRequest {
  id: number;
  pluginId: string;
  message: string;
}

interface PluginState {
  list: PluginEntry[];
  commands: PluginCommand[];
  slashCommands: PluginSlashCommand[];
  notifications: { id: number; pluginId: string; message: string }[];
  promptRequest: PluginPromptRequest | null;
  alertRequest: PluginAlertRequest | null;
  registries: string[];
  listings: MarketplaceListing[];
  marketLoading: boolean;
  marketError: string | null;
  refresh: () => Promise<void>;
  install: (srcDir: string) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  runCommand: (pluginId: string, commandId: string) => void;
  runSlash: (pluginId: string, trigger: string, blockId: string) => void;
  dispatchEvent: (name: string, payload: unknown) => void;
  dismissNotification: (id: number) => void;
  resolvePrompt: (id: number, value: string | null) => void;
  resolveAlert: (id: number) => void;
  addRegistry: (url: string) => Promise<void>;
  removeRegistry: (url: string) => void;
  refreshMarketplace: () => Promise<void>;
  installFromMarketplace: (entry: MarketplaceEntry) => Promise<void>;
  installBundled: (manifest: PluginManifest, source: string) => Promise<void>;
}

let promptSeq = 0;
const promptWaiters = new Map<number, (v: string | null) => void>();
const alertWaiters = new Map<number, () => void>();

const live = new Map<string, LivePlugin>();

async function startPlugin(entry: PluginEntry): Promise<LivePlugin | null> {
  let source: string;
  try {
    source = await invoke<string>("read_plugin_main", { id: entry.manifest.id });
  } catch (e) {
    console.error(`[plugin] failed to load ${entry.manifest.id}`, e);
    return null;
  }
  const worker = (
    entry.manifest.kind === "obsidian" ? new ObsidianPluginWorker() : new PluginWorker()
  ) as Worker;
  const live: LivePlugin = { entry, worker, ready: false };
  worker.addEventListener("message", (ev: MessageEvent) =>
    handleWorkerMessage(entry, worker, ev.data),
  );
  worker.addEventListener("error", (ev) => {
    console.error(`[plugin:${entry.manifest.id}] worker error`, ev.message);
  });
  worker.postMessage({ type: "init", source, manifest: entry.manifest });
  return live;
}

function stopPlugin(id: string) {
  const lp = live.get(id);
  if (!lp) return;
  lp.worker.terminate();
  live.delete(id);
  // Drop any registered commands belonging to this plugin.
  usePluginStore.setState((s) => ({
    commands: s.commands.filter((c) => c.pluginId !== id),
    slashCommands: s.slashCommands.filter((c) => c.pluginId !== id),
  }));
}

async function handleWorkerMessage(
  entry: PluginEntry,
  worker: Worker,
  data: unknown,
) {
  if (!data || typeof data !== "object") return;
  const msg = data as Record<string, unknown>;
  const pluginId = entry.manifest.id;
  const perms = new Set(entry.manifest.permissions);

  if (msg.__rs_ready) {
    const lp = live.get(pluginId);
    if (lp) lp.ready = true;
    return;
  }
  if (typeof msg.__rs_error === "string") {
    console.error(`[plugin:${pluginId}]`, msg.__rs_error);
    return;
  }

  if (msg.__rs_register === "command" && perms.has("commands")) {
    const id = String(msg.id);
    const label = String(msg.label);
    usePluginStore.setState((s) => ({
      commands: [
        ...s.commands.filter((c) => !(c.pluginId === pluginId && c.id === id)),
        { pluginId, id, label },
      ],
    }));
    return;
  }

  if (msg.__rs_register === "slash" && perms.has("slashCommands")) {
    const trigger = String(msg.trigger);
    const label = String(msg.label);
    usePluginStore.setState((s) => ({
      slashCommands: [
        ...s.slashCommands.filter(
          (c) => !(c.pluginId === pluginId && c.trigger === trigger),
        ),
        { pluginId, trigger, label },
      ],
    }));
    return;
  }

  if (msg.__rs_notify) {
    const message = String(msg.message ?? "");
    usePluginStore.setState((s) => ({
      notifications: [
        ...s.notifications.slice(-5),
        { id: Date.now() + Math.random(), pluginId, message },
      ],
    }));
    return;
  }

  if (msg.__rs_rpc) {
    const id = Number(msg.id);
    const method = String(msg.method);
    const args = Array.isArray(msg.args) ? (msg.args as unknown[]) : [];
    try {
      const value = await dispatchRpc(method, args, perms);
      worker.postMessage({ __rs_rpc: true, id, ok: true, value });
    } catch (e) {
      worker.postMessage({
        __rs_rpc: true,
        id,
        ok: false,
        error: String(e),
      });
    }
  }
}

async function dispatchRpc(
  method: string,
  args: unknown[],
  perms: Set<string>,
): Promise<unknown> {
  const needsRead = () => {
    if (!perms.has("readBlocks")) throw new Error("missing permission: readBlocks");
  };
  const needsWrite = () => {
    if (!perms.has("writeBlocks")) throw new Error("missing permission: writeBlocks");
  };
  const needsNet = () => {
    if (!perms.has("http")) throw new Error("missing permission: http");
  };
  switch (method) {
    case "listPages":
      needsRead();
      return api.listPages();
    case "getPage":
      needsRead();
      return api.getPage(String(args[0]));
    case "getBlock":
      needsRead();
      return api.getBlock(String(args[0]));
    case "getCurrentPage": {
      needsRead();
      const { usePageStore } = await import("./page");
      const id = usePageStore.getState().activePageId;
      if (!id) return null;
      return api.getPage(id);
    }
    case "todayJournal":
      needsRead();
      return api.todayJournal();
    case "runQuery":
      needsRead();
      return api.runQuery(String(args[0]));
    case "search":
      needsRead();
      return api.search(String(args[0]), Number(args[1] ?? 30));
    case "openTasks":
      needsRead();
      return api.openTasks();
    case "backlinks":
      needsRead();
      return api.backlinks(String(args[0]));
    case "blocksForDate":
      needsRead();
      return api.blocksForDate(Number(args[0]));
    case "listWhiteboards":
      needsRead();
      return api.listWhiteboards();
    case "createWhiteboard":
      needsWrite();
      return api.createWhiteboard(String(args[0]));
    case "openWhiteboard": {
      needsRead();
      const id = String(args[0]);
      const { useWhiteboardStore } = await import("./whiteboard");
      await useWhiteboardStore.getState().open(id);
      return null;
    }
    case "openPage": {
      needsRead();
      const id = String(args[0]);
      const { usePageStore } = await import("./page");
      await usePageStore.getState().openPage(id);
      const { useWhiteboardStore } = await import("./whiteboard");
      useWhiteboardStore.getState().showPage();
      return null;
    }
    case "clipperLog": {
      needsRead();
      try {
        return await invoke("clip_log");
      } catch {
        return [];
      }
    }
    case "clipperToken": {
      needsRead();
      try {
        return await invoke("get_clip_token");
      } catch {
        return "";
      }
    }
    case "updateBlock":
      needsWrite();
      return api.updateBlock(String(args[0]), String(args[1]));
    case "insertBlock":
      needsWrite();
      return api.insertBlock(
        String(args[0]),
        (args[1] as string | null) ?? null,
        (args[2] as string | null) ?? null,
        String(args[3]),
      );
    case "insertSibling": {
      needsWrite();
      const afterId = String(args[0]);
      const content = String(args[1]);
      const after = await api.getBlock(afterId);
      if (!after) throw new Error(`block not found: ${afterId}`);
      return api.insertBlock(after.page_id, after.parent_id, afterId, content);
    }
    case "receiveClip": {
      needsWrite();
      const payload = (args[0] ?? {}) as Record<string, unknown>;
      return invoke("receive_clip", { payload });
    }
    case "httpFetch": {
      needsNet();
      const url = String(args[0]);
      if (!/^https?:\/\//i.test(url)) throw new Error("only http(s) URLs allowed");
      const init = (args[1] ?? {}) as {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      };
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 20_000);
      try {
        const res = await fetch(url, {
          method: init.method ?? "GET",
          headers: init.headers,
          body: init.body,
          signal: ac.signal,
        });
        const text = await res.text();
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          headers[k] = v;
        });
        if (text.length > 2 * 1024 * 1024) {
          throw new Error("response body exceeds 2 MiB cap");
        }
        return { status: res.status, headers, body: text };
      } finally {
        clearTimeout(timeout);
      }
    }
    case "obsidianWritePage": {
      // Obsidian vault.write — overwrite the page with the given markdown.
      needsWrite();
      const name = String(args[0]);
      const data = String(args[1] ?? "");
      const id = name.trim().toLowerCase();
      let page = await api.getPage(id);
      if (!page) page = await api.createPage(name);
      // Replace existing top-level blocks with the supplied content as a
      // single block. This is destructive — Obsidian's storage model is
      // file-level, ours is block-level, so we collapse on the way in.
      for (const blockId of page.root_block_ids) {
        try {
          await api.deleteBlock(blockId);
        } catch {
          /* ignore individual delete failures */
        }
      }
      await api.insertBlock(page.id, null, null, data);
      return null;
    }
    case "obsidianLoadData": {
      try {
        const raw = localStorage.getItem(`logseq-rs:obsidian-data:${Array.from(perms).join(",")}`);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    }
    case "obsidianSaveData": {
      try {
        localStorage.setItem(
          `logseq-rs:obsidian-data:${Array.from(perms).join(",")}`,
          JSON.stringify(args[0] ?? null),
        );
      } catch {
        /* quota */
      }
      return null;
    }
    case "prompt": {
      const message = String(args[0] ?? "");
      const def = String(args[1] ?? "");
      return new Promise<string | null>((resolve) => {
        const id = ++promptSeq;
        promptWaiters.set(id, resolve);
        usePluginStore.setState({
          promptRequest: { id, pluginId: "plugin", message, default: def },
        });
      });
    }
    case "alert": {
      const message = String(args[0] ?? "");
      return new Promise<void>((resolve) => {
        const id = ++promptSeq;
        alertWaiters.set(id, resolve);
        usePluginStore.setState({
          alertRequest: { id, pluginId: "plugin", message },
        });
      });
    }
    default:
      throw new Error(`unknown rpc method: ${method}`);
  }
}

export const usePluginStore = create<PluginState>((set, get) => ({
  list: [],
  commands: [],
  slashCommands: [],
  notifications: [],
  promptRequest: null,
  alertRequest: null,
  registries: loadRegistries(),
  listings: [BUILTIN_MARKETPLACE],
  marketLoading: false,
  marketError: null,

  refresh: async () => {
    const list = await invoke<PluginEntry[]>("list_plugins");
    set({ list });
    // Reconcile live workers.
    const wanted = new Set(list.filter((e) => e.enabled).map((e) => e.manifest.id));
    for (const id of Array.from(live.keys())) {
      if (!wanted.has(id)) stopPlugin(id);
    }
    for (const entry of list) {
      if (!entry.enabled) continue;
      if (live.has(entry.manifest.id)) continue;
      const lp = await startPlugin(entry);
      if (lp) live.set(entry.manifest.id, lp);
    }
  },

  install: async (srcDir) => {
    await invoke<PluginEntry>("install_plugin", { srcDir });
    await get().refresh();
  },

  uninstall: async (id) => {
    stopPlugin(id);
    await invoke<void>("uninstall_plugin", { id });
    await get().refresh();
  },

  setEnabled: async (id, enabled) => {
    await invoke<PluginEntry>("set_plugin_enabled", { id, enabled });
    await get().refresh();
  },

  runCommand: (pluginId, commandId) => {
    const lp = live.get(pluginId);
    if (!lp || !lp.ready) return;
    lp.worker.postMessage({ __rs_invoke: "command", commandId });
  },

  runSlash: (pluginId, trigger, blockId) => {
    const lp = live.get(pluginId);
    if (!lp || !lp.ready) return;
    lp.worker.postMessage({ __rs_invoke: "slash", trigger, blockId });
  },

  dispatchEvent: (name, payload) => {
    for (const lp of live.values()) {
      lp.worker.postMessage({ __rs_event: true, name, payload });
    }
  },

  dismissNotification: (id) => {
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
  },

  resolvePrompt: (id, value) => {
    const w = promptWaiters.get(id);
    if (w) {
      promptWaiters.delete(id);
      w(value);
    }
    set({ promptRequest: null });
  },

  resolveAlert: (id) => {
    const w = alertWaiters.get(id);
    if (w) {
      alertWaiters.delete(id);
      w();
    }
    set({ alertRequest: null });
  },

  addRegistry: async (url) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    const next = Array.from(new Set([...get().registries, trimmed]));
    saveRegistries(next);
    set({ registries: next });
    await get().refreshMarketplace();
  },

  removeRegistry: (url) => {
    const next = get().registries.filter((u) => u !== url);
    saveRegistries(next);
    set({
      registries: next,
      listings: get().listings.filter((l) => l.source !== url),
    });
  },

  refreshMarketplace: async () => {
    const urls = get().registries;
    set({ marketLoading: true, marketError: null });
    const listings: MarketplaceListing[] = [BUILTIN_MARKETPLACE];
    let firstErr: string | null = null;
    for (const url of urls) {
      try {
        const listing = await invoke<MarketplaceListing>("fetch_marketplace", { url });
        listings.push(listing);
      } catch (e) {
        if (!firstErr) firstErr = `${url}: ${String(e)}`;
      }
    }
    set({ listings, marketLoading: false, marketError: firstErr });
  },

  installFromMarketplace: async (entry) => {
    await invoke<PluginEntry>("install_plugin_from_url", { entry });
    await get().refresh();
  },

  installBundled: async (manifest, source) => {
    await invoke<PluginEntry>("install_bundled_plugin", { manifest, mainJs: source });
    await get().refresh();
  },
}));
