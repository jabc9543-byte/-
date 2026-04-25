import { create } from "zustand";
import { api } from "../api";
import type { Block, Page, PageId } from "../types";
import { useFavoritesStore } from "./favorites";

interface PageState {
  pages: Page[];
  activePageId: PageId | null;
  page: Page | null;
  blocks: Block[];
  loading: boolean;

  refreshPages: () => Promise<void>;
  openPage: (id: PageId) => Promise<void>;
  openByName: (name: string) => Promise<void>;
  setAliases: (id: PageId, aliases: string[]) => Promise<void>;
  createPage: (name: string) => Promise<Page>;
  deletePage: (id: PageId) => Promise<void>;

  updateBlock: (id: string, content: string) => Promise<void>;
  insertSibling: (afterId: string, content?: string) => Promise<Block | null>;
  insertChild: (parentId: string, content?: string) => Promise<Block | null>;
  insertTopLevel: (content?: string) => Promise<Block | null>;
  deleteBlock: (id: string) => Promise<void>;
  indent: (id: string) => Promise<void>;
  outdent: (id: string) => Promise<void>;
  moveBlockTo: (
    id: string,
    newParent: string | null,
    newOrder: number,
  ) => Promise<void>;
  moveBlockUp: (id: string) => Promise<void>;
  moveBlockDown: (id: string) => Promise<void>;
  cycleTask: (id: string) => Promise<void>;
  openToday: () => Promise<void>;
}

async function loadBlocks(pageId: PageId): Promise<Block[]> {
  const page = await api.getPage(pageId);
  if (!page) return [];
  const result: Block[] = [];
  const visit = async (ids: string[]) => {
    for (const id of ids) {
      const b = await api.getBlock(id);
      if (!b) continue;
      result.push(b);
      if (b.children.length > 0) await visit(b.children);
    }
  };
  await visit(page.root_block_ids);
  return result;
}

export const usePageStore = create<PageState>((set, get) => ({
  pages: [],
  activePageId: null,
  page: null,
  blocks: [],
  loading: false,

  refreshPages: async () => {
    const pages = await api.listPages();
    set({ pages });
  },

  openPage: async (id) => {
    set({ loading: true, activePageId: id });
    const page = await api.getPage(id);
    const blocks = page ? await loadBlocks(id) : [];
    set({ page, blocks, loading: false });
    if (page) {
      try {
        useFavoritesStore.getState().pushRecent(id);
      } catch {
        // localStorage 不可用时静默忽略
      }
    }
  },

  // Open a page by user-typed name, consulting aliases on the backend.
  // Falls back to creating the page when nothing matches so that clicks on
  // `[[new-page]]` in a block's referenced-embeds area behave naturally.
  openByName: async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    let page = await api.resolvePage(trimmed);
    if (!page) {
      page = await api.createPage(trimmed);
      await get().refreshPages();
    }
    await get().openPage(page.id);
  },

  setAliases: async (id, aliases) => {
    const updated = await api.setPageAliases(id, aliases);
    // Refresh list (alias search) and active page if it's the same one.
    await get().refreshPages();
    if (get().activePageId === id) {
      set({ page: updated });
    }
  },

  createPage: async (name) => {
    const page = await api.createPage(name);
    await get().refreshPages();
    return page;
  },

  deletePage: async (id) => {
    await api.deletePage(id);
    if (get().activePageId === id) {
      set({ activePageId: null, page: null, blocks: [] });
    }
    try {
      useFavoritesStore.getState().forgetPage(id);
    } catch {
      // ignore
    }
    await get().refreshPages();
  },

  updateBlock: async (id, content) => {
    const updated = await api.updateBlock(id, content);
    set((s) => ({
      blocks: s.blocks.map((b) => (b.id === id ? { ...b, ...updated } : b)),
    }));
  },

  insertSibling: async (afterId, content = "") => {
    const { activePageId, blocks } = get();
    if (!activePageId) return null;
    const after = blocks.find((b) => b.id === afterId);
    if (!after) return null;
    const created = await api.insertBlock(
      activePageId,
      after.parent_id,
      afterId,
      content,
    );
    await get().openPage(activePageId);
    return created;
  },

  insertChild: async (parentId, content = "") => {
    const { activePageId } = get();
    if (!activePageId) return null;
    const created = await api.insertBlock(activePageId, parentId, null, content);
    await get().openPage(activePageId);
    return created;
  },

  insertTopLevel: async (content = "") => {
    const { activePageId } = get();
    if (!activePageId) return null;
    const created = await api.insertBlock(activePageId, null, null, content);
    await get().openPage(activePageId);
    return created;
  },

  deleteBlock: async (id) => {
    const { activePageId } = get();
    await api.deleteBlock(id);
    if (activePageId) await get().openPage(activePageId);
  },

  indent: async (id) => {
    const { activePageId, blocks } = get();
    if (!activePageId) return;
    const siblings = blocks.filter(
      (b) => b.parent_id === (blocks.find((x) => x.id === id)?.parent_id ?? null),
    );
    const idx = siblings.findIndex((b) => b.id === id);
    if (idx <= 0) return;
    const newParent = siblings[idx - 1].id;
    await api.moveBlock(id, newParent, 0);
    await get().openPage(activePageId);
  },

  outdent: async (id) => {
    const { activePageId, blocks } = get();
    if (!activePageId) return;
    const me = blocks.find((b) => b.id === id);
    if (!me || !me.parent_id) return;
    const parent = blocks.find((b) => b.id === me.parent_id);
    if (!parent) return;
    await api.moveBlock(id, parent.parent_id, parent.order + 1);
    await get().openPage(activePageId);
  },

  moveBlockTo: async (id, newParent, newOrder) => {
    const { activePageId, blocks } = get();
    if (!activePageId) return;
    const me = blocks.find((b) => b.id === id);
    if (!me) return;
    // Refuse cycles: newParent must not be a descendant of `id`.
    let cur: string | null = newParent;
    while (cur) {
      if (cur === id) return;
      const n: Block | undefined = blocks.find((b) => b.id === cur);
      cur = n ? n.parent_id : null;
    }
    await api.moveBlock(id, newParent, newOrder);
    await get().openPage(activePageId);
  },

  moveBlockUp: async (id) => {
    const { activePageId, blocks } = get();
    if (!activePageId) return;
    const me = blocks.find((b) => b.id === id);
    if (!me) return;
    const siblings = blocks
      .filter((b) => b.parent_id === me.parent_id)
      .sort((a, b) => a.order - b.order);
    const idx = siblings.findIndex((b) => b.id === id);
    if (idx <= 0) return;
    await api.moveBlock(id, me.parent_id, siblings[idx - 1].order);
    await get().openPage(activePageId);
  },

  moveBlockDown: async (id) => {
    const { activePageId, blocks } = get();
    if (!activePageId) return;
    const me = blocks.find((b) => b.id === id);
    if (!me) return;
    const siblings = blocks
      .filter((b) => b.parent_id === me.parent_id)
      .sort((a, b) => a.order - b.order);
    const idx = siblings.findIndex((b) => b.id === id);
    if (idx < 0 || idx >= siblings.length - 1) return;
    await api.moveBlock(id, me.parent_id, siblings[idx + 1].order + 1);
    await get().openPage(activePageId);
  },

  cycleTask: async (id) => {
    const updated = await api.cycleTask(id);
    set((s) => ({
      blocks: s.blocks.map((b) => (b.id === id ? { ...b, ...updated } : b)),
    }));
  },

  openToday: async () => {
    const page = await api.todayJournal();
    await get().refreshPages();
    await get().openPage(page.id);
  },
}));
