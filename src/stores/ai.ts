// AI assistant store (module 21). Handles config + an in-memory chat
// session with streaming deltas coming back as Tauri events.

import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api } from "../api";
import type { AiConfigView, AiMessage } from "../types";

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  error?: string;
}

interface AiState {
  config: AiConfigView | null;
  configLoading: boolean;
  turns: ChatTurn[];
  busy: boolean;
  activeSession: string | null;
  error: string | null;

  refreshConfig: () => Promise<void>;
  saveConfig: (patch: Partial<AiConfigView> & { api_key?: string }) =>
    Promise<void>;
  ask: (prompt: string, opts?: { preset?: string }) => Promise<void>;
  cancel: () => void;
  reset: () => void;
  clear: () => void;
}

function toMessages(turns: ChatTurn[]): AiMessage[] {
  return turns
    .filter((t) => !t.error && t.content.length > 0)
    .map((t) => ({ role: t.role, content: t.content }) satisfies AiMessage);
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const useAiStore = create<AiState>((set, get) => ({
  config: null,
  configLoading: false,
  turns: [],
  busy: false,
  activeSession: null,
  error: null,

  refreshConfig: async () => {
    set({ configLoading: true, error: null });
    try {
      const config = await api.aiConfig();
      set({ config, configLoading: false });
    } catch (e) {
      set({ configLoading: false, error: String(e) });
    }
  },

  saveConfig: async (patch) => {
    try {
      const config = await api.setAiConfig(patch);
      set({ config, error: null });
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  ask: async (prompt, _opts) => {
    if (get().busy) return;
    const userTurn: ChatTurn = {
      id: newId(),
      role: "user",
      content: prompt,
    };
    const assistantTurn: ChatTurn = {
      id: newId(),
      role: "assistant",
      content: "",
      streaming: true,
    };
    const priorTurns = get().turns;
    const nextTurns = [...priorTurns, userTurn, assistantTurn];
    set({ turns: nextTurns, busy: true, error: null });

    const history = toMessages([...priorTurns, userTurn]);
    let session: string;
    try {
      session = await api.aiCompleteStream(history);
    } catch (e) {
      set((s) => ({
        busy: false,
        activeSession: null,
        turns: s.turns.map((t) =>
          t.id === assistantTurn.id
            ? { ...t, streaming: false, error: String(e) }
            : t,
        ),
      }));
      return;
    }
    set({ activeSession: session });

    const unlisteners: UnlistenFn[] = [];
    const finish = () => {
      unlisteners.forEach((u) => u());
      set({ busy: false, activeSession: null });
      set((s) => ({
        turns: s.turns.map((t) =>
          t.id === assistantTurn.id ? { ...t, streaming: false } : t,
        ),
      }));
    };

    unlisteners.push(
      await listen<string>(`ai://delta-${session}`, (event) => {
        // Ignore if a newer session has started or was cancelled.
        if (get().activeSession !== session) return;
        const chunk = event.payload;
        set((s) => ({
          turns: s.turns.map((t) =>
            t.id === assistantTurn.id
              ? { ...t, content: t.content + chunk }
              : t,
          ),
        }));
      }),
    );
    unlisteners.push(
      await listen<string>(`ai://done-${session}`, (event) => {
        if (get().activeSession !== session) {
          unlisteners.forEach((u) => u());
          return;
        }
        set((s) => ({
          turns: s.turns.map((t) =>
            t.id === assistantTurn.id
              ? { ...t, content: event.payload, streaming: false }
              : t,
          ),
        }));
        finish();
      }),
    );
    unlisteners.push(
      await listen<string>(`ai://error-${session}`, (event) => {
        if (get().activeSession !== session) {
          unlisteners.forEach((u) => u());
          return;
        }
        set((s) => ({
          turns: s.turns.map((t) =>
            t.id === assistantTurn.id
              ? { ...t, streaming: false, error: event.payload }
              : t,
          ),
          error: event.payload,
        }));
        finish();
      }),
    );
  },

  cancel: () => {
    const s = get();
    if (!s.activeSession) return;
    // Drop the session id so future events are ignored; also mark the last
    // assistant turn as no longer streaming.
    set((st) => ({
      busy: false,
      activeSession: null,
      turns: st.turns.map((t, i, arr) =>
        i === arr.length - 1 && t.role === "assistant"
          ? { ...t, streaming: false }
          : t,
      ),
    }));
  },

  reset: () => set({ turns: [], error: null }),

  clear: () =>
    set({
      config: null,
      configLoading: false,
      turns: [],
      busy: false,
      activeSession: null,
      error: null,
    }),
}));
