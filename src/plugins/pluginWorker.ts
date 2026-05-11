/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */
// Sandbox worker for Logseq-RS plugins.
// Runs the plugin entry source inside its own scope and exposes a minimal
// `logseq` global. All host interaction is performed via postMessage.

export {};

declare const self: DedicatedWorkerGlobalScope & { logseq?: PluginApi };

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

interface PluginApi {
  manifest: unknown;
  commands: {
    register(id: string, label: string, handler: () => unknown | Promise<unknown>): void;
  };
  slash: {
    register(trigger: string, label: string, handler: (ctx: { blockId: string }) => unknown | Promise<unknown>): void;
  };
  events: {
    on(name: string, cb: (payload: unknown) => void): void;
  };
  api: {
    listPages(): Promise<unknown>;
    getPage(id: string): Promise<unknown>;
    getBlock(id: string): Promise<unknown>;
    updateBlock(id: string, content: string): Promise<unknown>;
    insertBlock(page: string, parent: string | null, after: string | null, content: string): Promise<unknown>;
    insertSibling(afterId: string, content: string): Promise<unknown>;
    search(query: string, limit?: number): Promise<unknown>;
    runQuery(query: string): Promise<unknown>;
    todayJournal(): Promise<unknown>;
    getCurrentPage(): Promise<unknown>;
    httpFetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
    receiveClip(payload: { title: string; url: string; body: string; tags?: string[]; mode?: "page" | "journal" }): Promise<unknown>;
    notify(message: string): void;
  };
}

let rpcSeq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
const commandHandlers = new Map<string, () => unknown | Promise<unknown>>();
const slashHandlers = new Map<string, (ctx: { blockId: string }) => unknown | Promise<unknown>>();
const eventHandlers = new Map<string, Array<(payload: unknown) => void>>();

function rpc<T>(method: string, args: unknown[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++rpcSeq;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    self.postMessage({ __rs_rpc: true, id, method, args });
  });
}

function buildApi(manifest: unknown): PluginApi {
  return {
    manifest,
    commands: {
      register(id, label, handler) {
        commandHandlers.set(id, handler);
        self.postMessage({ __rs_register: "command", id, label });
      },
    },
    slash: {
      register(trigger, label, handler) {
        slashHandlers.set(trigger, handler);
        self.postMessage({ __rs_register: "slash", trigger, label });
      },
    },
    events: {
      on(name, cb) {
        const arr = eventHandlers.get(name) ?? [];
        arr.push(cb);
        eventHandlers.set(name, arr);
      },
    },
    api: {
      listPages: () => rpc("listPages"),
      getPage: (id) => rpc("getPage", [id]),
      getBlock: (id) => rpc("getBlock", [id]),
      updateBlock: (id, c) => rpc("updateBlock", [id, c]),
      insertBlock: (p, parent, after, c) => rpc("insertBlock", [p, parent, after, c]),
      insertSibling: (afterId, c) => rpc("insertSibling", [afterId, c]),
      search: (q, limit = 30) => rpc("search", [q, limit]),
      runQuery: (q) => rpc("runQuery", [q]),
      todayJournal: () => rpc("todayJournal"),
      getCurrentPage: () => rpc("getCurrentPage"),
      httpFetch: (url, init) =>
        rpc("httpFetch", [url, init ?? {}]) as Promise<{
          status: number;
          headers: Record<string, string>;
          body: string;
        }>,
      receiveClip: (payload) => rpc("receiveClip", [payload]),
      notify: (message) => {
        self.postMessage({ __rs_notify: true, message });
      },
    },
  };
}

self.addEventListener("message", async (ev: MessageEvent) => {
  const data = ev.data as Record<string, unknown> | null;
  if (!data) return;

  if (data.type === "init") {
    const source = String(data.source ?? "");
    const manifest = data.manifest;
    const api = buildApi(manifest);
    self.logseq = api;
    try {
      // eslint-disable-next-line no-new-func
      new Function("logseq", source)(api);
      self.postMessage({ __rs_ready: true });
    } catch (e) {
      self.postMessage({ __rs_error: String(e) });
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
        console.error(`[plugin] event handler "${evt.name}" threw`, e);
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
        console.error("[plugin] command failed", commandId, e);
      }
    }
    return;
  }

  if (data.__rs_invoke === "slash") {
    const trigger = String(data.trigger ?? "");
    const blockId = String(data.blockId ?? "");
    const h = slashHandlers.get(trigger);
    if (h) {
      try {
        await h({ blockId });
      } catch (e) {
        console.error("[plugin] slash failed", trigger, e);
      }
    }
  }
});
