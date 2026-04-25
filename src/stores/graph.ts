import { create } from "zustand";
import { api } from "../api";
import type { GraphMeta } from "../types";

interface GraphState {
  graph: GraphMeta | null;
  hydrate: () => Promise<void>;
  open: (path: string) => Promise<void>;
  close: () => Promise<void>;
}

export const useGraphStore = create<GraphState>((set) => ({
  graph: null,
  hydrate: async () => {
    const g = await api.currentGraph();
    set({ graph: g });
  },
  open: async (path) => {
    const g = await api.openGraph(path);
    set({ graph: g });
  },
  close: async () => {
    await api.closeGraph();
    set({ graph: null });
  },
}));
