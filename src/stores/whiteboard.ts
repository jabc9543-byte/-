import { create } from "zustand";
import { api } from "../api";
import type { Whiteboard, WhiteboardSummary } from "../types";

export type ViewMode =
  | { kind: "page" }
  | { kind: "whiteboard"; id: string }
  | { kind: "graph" }
  | { kind: "page-graph"; pageId: string }
  | { kind: "pdf" }
  | { kind: "calendar" }
  | { kind: "dashboard" }
  | { kind: "search" }
  | { kind: "agenda" };

interface WhiteboardState {
  view: ViewMode;
  list: WhiteboardSummary[];
  active: Whiteboard | null;
  loading: boolean;

  showPage: () => void;
  showGraph: () => void;
  showPageGraph: (pageId: string) => void;
  showPdf: () => void;
  showCalendar: () => void;
  showDashboard: () => void;
  showSearch: () => void;
  showAgenda: () => void;
  refreshList: () => Promise<void>;
  open: (id: string) => Promise<void>;
  create: (name: string) => Promise<Whiteboard>;
  save: (id: string, data: unknown) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useWhiteboardStore = create<WhiteboardState>((set, get) => ({
  view: { kind: "page" },
  list: [],
  active: null,
  loading: false,

  showPage: () => set({ view: { kind: "page" } }),

  showGraph: () => set({ view: { kind: "graph" } }),

  showPageGraph: (pageId) => set({ view: { kind: "page-graph", pageId } }),

  showPdf: () => set({ view: { kind: "pdf" } }),

  showCalendar: () => set({ view: { kind: "calendar" } }),

  showDashboard: () => set({ view: { kind: "dashboard" } }),

  showSearch: () => set({ view: { kind: "search" } }),

  showAgenda: () => set({ view: { kind: "agenda" } }),

  refreshList: async () => {
    const list = await api.listWhiteboards();
    set({ list });
  },

  open: async (id) => {
    set({ loading: true });
    try {
      const wb = await api.getWhiteboard(id);
      set({ active: wb ?? null, view: { kind: "whiteboard", id } });
    } finally {
      set({ loading: false });
    }
  },

  create: async (name) => {
    const wb = await api.createWhiteboard(name);
    await get().refreshList();
    set({ active: wb, view: { kind: "whiteboard", id: wb.id } });
    return wb;
  },

  save: async (id, data) => {
    const wb = await api.saveWhiteboard(id, data);
    set((s) => ({ active: s.active?.id === id ? wb : s.active }));
  },

  remove: async (id) => {
    await api.deleteWhiteboard(id);
    const { active, view } = get();
    await get().refreshList();
    if (active?.id === id) set({ active: null });
    if (view.kind === "whiteboard" && view.id === id)
      set({ view: { kind: "page" } });
  },
}));
