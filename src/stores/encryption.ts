import { create } from "zustand";
import { api } from "../api";
import type { EncryptionStatus } from "../types";

interface EncryptionState {
  status: EncryptionStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  clear: () => void;
  enable: (passphrase: string) => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  lock: () => Promise<void>;
  changePassphrase: (oldPass: string, newPass: string) => Promise<void>;
  disable: (passphrase: string) => Promise<void>;
}

async function call<T>(
  set: (p: Partial<EncryptionState>) => void,
  fn: () => Promise<T>,
): Promise<T> {
  set({ loading: true, error: null });
  try {
    const res = await fn();
    set({ loading: false });
    return res;
  } catch (e) {
    set({ loading: false, error: String(e) });
    throw e;
  }
}

export const useEncryptionStore = create<EncryptionState>((set) => ({
  status: null,
  loading: false,
  error: null,

  clear: () => set({ status: null, error: null, loading: false }),

  refresh: async () => {
    const s = await call(set, () => api.encryptionStatus());
    set({ status: s });
  },

  enable: async (passphrase) => {
    const s = await call(set, () => api.enableEncryption(passphrase));
    set({ status: s });
  },

  unlock: async (passphrase) => {
    const s = await call(set, () => api.unlockEncryption(passphrase));
    set({ status: s });
  },

  lock: async () => {
    const s = await call(set, () => api.lockEncryption());
    set({ status: s });
  },

  changePassphrase: async (oldPass, newPass) => {
    const s = await call(set, () => api.changeEncryptionPassphrase(oldPass, newPass));
    set({ status: s });
  },

  disable: async (passphrase) => {
    const s = await call(set, () => api.disableEncryption(passphrase));
    set({ status: s });
  },
}));

// Convenience selector.
export const selectLocked = (s: EncryptionState): boolean =>
  !!s.status && s.status.enabled && !s.status.unlocked;
