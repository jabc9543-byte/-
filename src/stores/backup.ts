// Backup store (module 28). Keeps an in-memory list of snapshots with
// manual refresh; the scheduler runs purely on the Rust side.

import { create } from "zustand";
import { api } from "../api";
import type { BackupConfig, BackupEntry } from "../types";

interface BackupState {
  entries: BackupEntry[];
  config: BackupConfig | null;
  lastRunAt: string | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setConfig: (cfg: BackupConfig) => Promise<void>;
  createNow: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  restore: (id: string) => Promise<string>;
  clear: () => void;
}

async function wrap<T>(
  set: (patch: Partial<BackupState>) => void,
  key: "loading" | "busy",
  fn: () => Promise<T>,
): Promise<T> {
  set({ [key]: true, error: null } as Partial<BackupState>);
  try {
    const out = await fn();
    set({ [key]: false } as Partial<BackupState>);
    return out;
  } catch (e) {
    set({ [key]: false, error: String(e) } as Partial<BackupState>);
    throw e;
  }
}

export const useBackupStore = create<BackupState>((set, get) => ({
  entries: [],
  config: null,
  lastRunAt: null,
  loading: false,
  busy: false,
  error: null,

  refresh: async () => {
    await wrap(set, "loading", async () => {
      const [entries, config, lastRunAt] = await Promise.all([
        api.listBackups(),
        api.backupConfig(),
        api.lastBackupAt(),
      ]);
      set({ entries, config, lastRunAt });
    });
  },

  setConfig: async (cfg) => {
    const config = await wrap(set, "busy", () => api.setBackupConfig(cfg));
    set({ config });
  },

  createNow: async () => {
    await wrap(set, "busy", async () => {
      await api.createBackup();
      const [entries, lastRunAt] = await Promise.all([
        api.listBackups(),
        api.lastBackupAt(),
      ]);
      set({ entries, lastRunAt });
    });
  },

  remove: async (id) => {
    await wrap(set, "busy", async () => {
      await api.deleteBackup(id);
      set({ entries: get().entries.filter((e) => e.id !== id) });
    });
  },

  restore: async (id) => {
    return wrap(set, "busy", () => api.restoreBackup(id));
  },

  clear: () =>
    set({
      entries: [],
      config: null,
      lastRunAt: null,
      loading: false,
      busy: false,
      error: null,
    }),
}));
