import { create } from "zustand";

export interface CollabSettings {
  enabled: boolean;
  serverUrl: string;
  displayName: string;
  color: string;
}

interface SettingsState {
  spellcheck: boolean;
  collab: CollabSettings;
  toggleSpellcheck: () => void;
  setCollab: (patch: Partial<CollabSettings>) => void;
  toggleCollab: () => void;
}

const LS_KEY = "logseq-rs.settings";

const PALETTE = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
];

function randomColor(): string {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

function defaultCollab(): CollabSettings {
  return {
    enabled: false,
    serverUrl: "ws://localhost:1234",
    displayName: "Anonymous",
    color: randomColor(),
  };
}

interface Persisted {
  spellcheck: boolean;
  collab: CollabSettings;
}

function load(): Persisted {
  const fallback: Persisted = { spellcheck: true, collab: defaultCollab() };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      spellcheck: parsed.spellcheck ?? true,
      collab: { ...defaultCollab(), ...(parsed.collab ?? {}) },
    };
  } catch {
    return fallback;
  }
}

function persist(s: Persisted) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...load(),
  toggleSpellcheck: () => {
    const next = !get().spellcheck;
    set({ spellcheck: next });
    persist({ spellcheck: next, collab: get().collab });
  },
  setCollab: (patch) => {
    const next = { ...get().collab, ...patch };
    set({ collab: next });
    persist({ spellcheck: get().spellcheck, collab: next });
  },
  toggleCollab: () => {
    const next = { ...get().collab, enabled: !get().collab.enabled };
    set({ collab: next });
    persist({ spellcheck: get().spellcheck, collab: next });
  },
}));
