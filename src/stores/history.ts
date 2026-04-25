import { create } from "zustand";

interface HistoryPanelState {
  blockId: string | null;
  open: (blockId: string) => void;
  close: () => void;
}

export const useHistoryPanelStore = create<HistoryPanelState>((set) => ({
  blockId: null,
  open: (blockId) => set({ blockId }),
  close: () => set({ blockId: null }),
}));
