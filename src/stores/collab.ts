import { create } from "zustand";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";
import { api } from "../api";
import type { BlockId } from "../types";

// ---- Collaboration store ----
//
// One Y.Doc per open graph. Each block's content is stored as a Y.Text keyed
// by block id inside a top-level Y.Map("blocks"). A WebSocket provider
// synchronises with a relay server (any y-websocket-server-compatible host),
// and an IndexedDB provider keeps offline persistence.
//
// Awareness carries {name, color, blockId, anchor, head} so peers can render
// remote presence alongside local editing.

export interface CollabUser {
  clientId: number;
  name: string;
  color: string;
  blockId: string | null;
  anchor: number | null;
  head: number | null;
}

export type CollabStatus = "disabled" | "connecting" | "connected" | "disconnected" | "error";

interface CollabState {
  status: CollabStatus;
  error: string | null;
  room: string | null;
  doc: Y.Doc | null;
  blocks: Y.Map<Y.Text> | null;
  provider: WebsocketProvider | null;
  persistence: IndexeddbPersistence | null;
  peers: CollabUser[];
  start: (opts: { room: string; serverUrl: string; name: string; color: string }) => void;
  stop: () => void;
  setLocalPresence: (patch: Partial<Omit<CollabUser, "clientId">>) => void;
  getOrCreateText: (blockId: BlockId, initial: string) => Y.Text;
  // Debounced persistence hook: schedule saving a block to disk after
  // remote edits land so the Rust store stays in sync.
  markDirty: (blockId: BlockId) => void;
}

const dirtyTimers = new Map<string, number>();
const DIRTY_DELAY = 600;

function schedulePersist(blockId: BlockId, getText: () => Y.Text | undefined) {
  const existing = dirtyTimers.get(blockId);
  if (existing !== undefined) window.clearTimeout(existing);
  const h = window.setTimeout(async () => {
    dirtyTimers.delete(blockId);
    const t = getText();
    if (!t) return;
    try {
      await api.updateBlock(blockId, t.toString());
    } catch (e) {
      console.error("[collab] persist failed", blockId, e);
    }
  }, DIRTY_DELAY);
  dirtyTimers.set(blockId, h);
}

export const useCollabStore = create<CollabState>((set, get) => ({
  status: "disabled",
  error: null,
  room: null,
  doc: null,
  blocks: null,
  provider: null,
  persistence: null,
  peers: [],

  start: ({ room, serverUrl, name, color }) => {
    // Idempotent: stop any prior session before re-starting.
    get().stop();

    const doc = new Y.Doc();
    const blocks = doc.getMap<Y.Text>("blocks");

    let persistence: IndexeddbPersistence | null = null;
    try {
      persistence = new IndexeddbPersistence(`logseq-rs:${room}`, doc);
    } catch (e) {
      console.warn("[collab] IndexedDB persistence unavailable", e);
    }

    let provider: WebsocketProvider;
    try {
      provider = new WebsocketProvider(serverUrl, room, doc);
    } catch (e) {
      set({ status: "error", error: String(e) });
      doc.destroy();
      return;
    }

    provider.awareness.setLocalStateField("user", {
      name,
      color,
      blockId: null,
      anchor: null,
      head: null,
    });

    provider.on("status", (ev: { status: string }) => {
      if (ev.status === "connected") set({ status: "connected", error: null });
      else if (ev.status === "connecting") set({ status: "connecting" });
      else if (ev.status === "disconnected") set({ status: "disconnected" });
    });

    const refreshPeers = () => {
      const states = provider.awareness.getStates();
      const self = provider.awareness.clientID;
      const peers: CollabUser[] = [];
      states.forEach((value, clientId) => {
        if (clientId === self) return;
        const u = (value as { user?: Partial<CollabUser> }).user;
        if (!u) return;
        peers.push({
          clientId,
          name: u.name ?? "Anonymous",
          color: u.color ?? "#888",
          blockId: u.blockId ?? null,
          anchor: u.anchor ?? null,
          head: u.head ?? null,
        });
      });
      set({ peers });
    };

    provider.awareness.on("change", refreshPeers);

    // Cross-client persistence: when remote edits land, write the block back
    // to the local Rust store so other windows / sessions read the fresh text.
    blocks.observeDeep((events) => {
      for (const ev of events) {
        // The target may be the blocks map itself (key add/remove) or a Y.Text.
        if (ev.target instanceof Y.Text) {
          // Find which key in the map refers to this Y.Text.
          const t = ev.target;
          blocks.forEach((v, k) => {
            if (v === t) schedulePersist(k, () => blocks.get(k));
          });
        }
      }
    });

    set({
      status: "connecting",
      error: null,
      room,
      doc,
      blocks,
      provider,
      persistence,
      peers: [],
    });
  },

  stop: () => {
    const { provider, persistence, doc } = get();
    dirtyTimers.forEach((h) => window.clearTimeout(h));
    dirtyTimers.clear();
    try {
      provider?.disconnect();
      provider?.destroy();
    } catch { /* ignore */ }
    try {
      persistence?.destroy();
    } catch { /* ignore */ }
    try {
      doc?.destroy();
    } catch { /* ignore */ }
    set({
      status: "disabled",
      error: null,
      room: null,
      doc: null,
      blocks: null,
      provider: null,
      persistence: null,
      peers: [],
    });
  },

  setLocalPresence: (patch) => {
    const { provider } = get();
    if (!provider) return;
    const current = (provider.awareness.getLocalState() as { user?: CollabUser })?.user;
    if (!current) return;
    provider.awareness.setLocalStateField("user", { ...current, ...patch });
  },

  getOrCreateText: (blockId, initial) => {
    const { blocks, doc } = get();
    if (!blocks || !doc) throw new Error("collab not started");
    let t = blocks.get(blockId);
    if (!t) {
      t = new Y.Text();
      // Seed with the local content so first peer writes match disk state.
      t.insert(0, initial);
      blocks.set(blockId, t);
    }
    return t;
  },

  markDirty: (blockId) => {
    const { blocks } = get();
    if (!blocks) return;
    schedulePersist(blockId, () => blocks.get(blockId));
  },
}));
