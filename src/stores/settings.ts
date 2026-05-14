import { create } from "zustand";

export type ThemeMode = "system" | "light" | "dark";

export interface CollabSettings {
  enabled: boolean;
  serverUrl: string;
  displayName: string;
  color: string;
}

interface SettingsState {
  spellcheck: boolean;
  collab: CollabSettings;
  theme: ThemeMode;
  toggleSpellcheck: () => void;
  setCollab: (patch: Partial<CollabSettings>) => void;
  toggleCollab: () => void;
  setTheme: (mode: ThemeMode) => void;
  cycleTheme: () => void;
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
  theme: ThemeMode;
}

function load(): Persisted {
  const fallback: Persisted = {
    spellcheck: true,
    collab: defaultCollab(),
    theme: "system",
  };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const themeRaw = parsed.theme;
    const theme: ThemeMode =
      themeRaw === "light" || themeRaw === "dark" ? themeRaw : "system";
    return {
      spellcheck: parsed.spellcheck ?? true,
      collab: { ...defaultCollab(), ...(parsed.collab ?? {}) },
      theme,
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

export function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", mode);
  }
}

const initial = load();
applyTheme(initial.theme);
// Restore an "extended" theme (set by the bundled Themes plugin) if any —
// it overrides the system/light/dark base.
try {
  if (typeof document !== "undefined" && typeof localStorage !== "undefined") {
    const extra = localStorage.getItem("quanshiwei:extra-theme");
    if (extra && extra !== "system" && extra !== "light" && extra !== "dark") {
      document.documentElement.setAttribute("data-theme", extra);
    }
  }
} catch {
  /* ignore */
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...initial,
  toggleSpellcheck: () => {
    const next = !get().spellcheck;
    set({ spellcheck: next });
    persist({ spellcheck: next, collab: get().collab, theme: get().theme });
  },
  setCollab: (patch) => {
    const next = { ...get().collab, ...patch };
    set({ collab: next });
    persist({ spellcheck: get().spellcheck, collab: next, theme: get().theme });
  },
  toggleCollab: () => {
    const next = { ...get().collab, enabled: !get().collab.enabled };
    set({ collab: next });
    persist({ spellcheck: get().spellcheck, collab: next, theme: get().theme });
  },
  setTheme: (mode) => {
    set({ theme: mode });
    applyTheme(mode);
    persist({ spellcheck: get().spellcheck, collab: get().collab, theme: mode });
  },
  cycleTheme: () => {
    const order: ThemeMode[] = ["system", "light", "dark"];
    const cur = get().theme;
    const next = order[(order.indexOf(cur) + 1) % order.length];
    set({ theme: next });
    applyTheme(next);
    persist({ spellcheck: get().spellcheck, collab: get().collab, theme: next });
  },
}));
