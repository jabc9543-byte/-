import { create } from "zustand";

interface HelpState {
  open: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
}

export const useHelpStore = create<HelpState>((set, get) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set({ open: !get().open }),
}));
