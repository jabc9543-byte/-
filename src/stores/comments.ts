// Comment store (module 27).
//
// Client-side cache of block comments with optional real-time refresh via a
// small "bump" counter in the shared Y.Doc: whenever a local mutation
// succeeds we increment the counter, and peers observing it re-fetch from
// the backend. Backend JSON is the single source of truth; the CRDT bump is
// purely a signal channel.

import { create } from "zustand";
import { api } from "../api";
import type { BlockId, Comment } from "../types";
import { useCollabStore } from "./collab";
import { useSettingsStore } from "./settings";

interface CommentsState {
  byBlock: Record<string, Comment[]>;
  open: Comment[];
  selectedBlockId: BlockId | null;
  panelOpen: boolean;
  inboxOpen: boolean;
  loading: boolean;
  error: string | null;
  // actions
  openPanel: (blockId: BlockId) => Promise<void>;
  closePanel: () => void;
  toggleInbox: () => void;
  refreshBlock: (blockId: BlockId) => Promise<void>;
  refreshOpen: () => Promise<void>;
  add: (
    blockId: BlockId,
    body: string,
    parentId?: string | null,
  ) => Promise<void>;
  update: (id: string, body: string) => Promise<void>;
  toggleResolved: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clear: () => void;
}

function bumpCollab() {
  const { doc } = useCollabStore.getState();
  if (!doc) return;
  try {
    const m = doc.getMap<number>("comments_bump");
    m.set("n", (m.get("n") ?? 0) + 1);
  } catch {
    /* ignore */
  }
}

export const useCommentsStore = create<CommentsState>((set, get) => ({
  byBlock: {},
  open: [],
  selectedBlockId: null,
  panelOpen: false,
  inboxOpen: false,
  loading: false,
  error: null,

  openPanel: async (blockId) => {
    set({ selectedBlockId: blockId, panelOpen: true });
    await get().refreshBlock(blockId);
  },

  closePanel: () => set({ panelOpen: false }),

  toggleInbox: () => {
    const next = !get().inboxOpen;
    set({ inboxOpen: next });
    if (next) get().refreshOpen().catch(() => {});
  },

  refreshBlock: async (blockId) => {
    set({ loading: true, error: null });
    try {
      const list = await api.listBlockComments(blockId);
      set((s) => ({
        byBlock: { ...s.byBlock, [blockId]: list },
        loading: false,
      }));
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  refreshOpen: async () => {
    try {
      const list = await api.listOpenComments();
      set({ open: list });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  add: async (blockId, body, parentId = null) => {
    const cfg = useSettingsStore.getState().collab;
    const author = cfg.displayName || "You";
    const authorColor = cfg.color || "#6aa9ff";
    try {
      await api.addComment(blockId, author, authorColor, body, parentId);
      await get().refreshBlock(blockId);
      await get().refreshOpen();
      bumpCollab();
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  update: async (id, body) => {
    try {
      const updated = await api.updateComment(id, body);
      await get().refreshBlock(updated.block_id);
      await get().refreshOpen();
      bumpCollab();
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  toggleResolved: async (id) => {
    const blockId = get().selectedBlockId;
    const all = blockId ? get().byBlock[blockId] ?? [] : [];
    const current = all.find((c) => c.id === id);
    const next = !(current?.resolved ?? false);
    try {
      const updated = await api.resolveComment(id, next);
      await get().refreshBlock(updated.block_id);
      await get().refreshOpen();
      bumpCollab();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  remove: async (id) => {
    const blockId = get().selectedBlockId;
    try {
      await api.deleteComment(id);
      if (blockId) await get().refreshBlock(blockId);
      await get().refreshOpen();
      bumpCollab();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  clear: () =>
    set({
      byBlock: {},
      open: [],
      selectedBlockId: null,
      panelOpen: false,
      inboxOpen: false,
      loading: false,
      error: null,
    }),
}));

export const selectBlockCounts = (blockId: BlockId) =>
  (s: CommentsState): { total: number; open: number } => {
    const list = s.byBlock[blockId];
    if (!list) return { total: 0, open: 0 };
    let open = 0;
    for (const c of list) if (!c.resolved) open++;
    return { total: list.length, open };
  };
