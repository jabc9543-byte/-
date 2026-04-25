import { create } from "zustand";

/**
 * Keymap / shortcut registry (module 16).
 *
 * Shortcuts are stored as canonical "chord" strings like:
 *   "Mod+Shift+P", "Mod+K", "Alt+ArrowUp", "Ctrl+Enter"
 * where `Mod` is Ctrl on Win/Linux and Cmd on macOS. We also accept literal
 * "Ctrl"/"Meta" but `Mod` is preferred so bindings are portable.
 *
 * Commands are registered at runtime by UI code via `registerCommand`; the
 * user can override the default chord for any command through the Settings
 * modal. Overrides are persisted to localStorage.
 */

export interface KeymapCommand {
  /** Stable identifier, e.g. "palette.open". */
  id: string;
  /** Human-readable label used in the keymap editor. */
  label: string;
  /** Default chord (may be empty to mean "unbound by default"). */
  defaultChord: string;
  /** Handler invoked when the chord is pressed. */
  run: () => void | Promise<void>;
  /**
   * When true, the shortcut fires even if focus is inside an editable
   * element (textarea / input / contenteditable). Defaults to false so
   * block editors keep their own keys.
   */
  allowInEditable?: boolean;
}

interface KeymapState {
  commands: Map<string, KeymapCommand>;
  /** User overrides: commandId -> chord (empty string disables). */
  overrides: Record<string, string>;
  registerCommand: (cmd: KeymapCommand) => () => void;
  unregisterCommand: (id: string) => void;
  setOverride: (id: string, chord: string) => void;
  resetOverride: (id: string) => void;
  resetAll: () => void;
  chordFor: (id: string) => string;
  handleKeyEvent: (e: KeyboardEvent) => boolean;
}

const LS_KEY = "logseq-rs.keymap.overrides";

function loadOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function persistOverrides(o: Record<string, string>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}

/**
 * Translate a KeyboardEvent into its canonical chord form. Examples:
 *   { ctrlKey: true, key: "k" }                     -> "Mod+K"
 *   { ctrlKey: true, shiftKey: true, key: "P" }     -> "Mod+Shift+P"
 *   { altKey: true, key: "ArrowUp" }                -> "Alt+ArrowUp"
 * Modifier-only events (Ctrl/Shift/Alt/Meta) are ignored by returning "".
 */
export function chordFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Mod");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const k = e.key;
  if (k === "Control" || k === "Shift" || k === "Alt" || k === "Meta") {
    return "";
  }
  let keyLabel = k;
  if (k.length === 1) keyLabel = k.toUpperCase();
  // Normalise spacebar
  if (k === " ") keyLabel = "Space";
  parts.push(keyLabel);
  return parts.join("+");
}

/**
 * Normalise a human-typed chord like " ctrl + shift + p " to "Mod+Shift+P".
 */
export function normaliseChord(input: string): string {
  if (!input.trim()) return "";
  const tokens = input
    .split("+")
    .map((t) => t.trim())
    .filter(Boolean);
  const mods = new Set<string>();
  let key = "";
  for (const t of tokens) {
    const low = t.toLowerCase();
    if (low === "mod" || low === "ctrl" || low === "control" || low === "cmd" || low === "meta") {
      mods.add("Mod");
    } else if (low === "alt" || low === "option") {
      mods.add("Alt");
    } else if (low === "shift") {
      mods.add("Shift");
    } else {
      key = t.length === 1 ? t.toUpperCase() : t;
    }
  }
  if (!key) return "";
  const out: string[] = [];
  if (mods.has("Mod")) out.push("Mod");
  if (mods.has("Alt")) out.push("Alt");
  if (mods.has("Shift")) out.push("Shift");
  out.push(key);
  return out.join("+");
}

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "input" || tag === "select") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export const useKeymapStore = create<KeymapState>((set, get) => ({
  commands: new Map(),
  overrides: loadOverrides(),

  registerCommand: (cmd) => {
    const next = new Map(get().commands);
    next.set(cmd.id, cmd);
    set({ commands: next });
    return () => get().unregisterCommand(cmd.id);
  },

  unregisterCommand: (id) => {
    const next = new Map(get().commands);
    next.delete(id);
    set({ commands: next });
  },

  setOverride: (id, chord) => {
    const normalised = normaliseChord(chord);
    const next = { ...get().overrides, [id]: normalised };
    set({ overrides: next });
    persistOverrides(next);
  },

  resetOverride: (id) => {
    const next = { ...get().overrides };
    delete next[id];
    set({ overrides: next });
    persistOverrides(next);
  },

  resetAll: () => {
    set({ overrides: {} });
    persistOverrides({});
  },

  chordFor: (id) => {
    const ov = get().overrides;
    if (Object.prototype.hasOwnProperty.call(ov, id)) return ov[id];
    return get().commands.get(id)?.defaultChord ?? "";
  },

  handleKeyEvent: (e) => {
    const chord = chordFromEvent(e);
    if (!chord) return false;
    const { commands, chordFor } = get();
    const editable = isEditable(document.activeElement);
    for (const cmd of commands.values()) {
      const bound = chordFor(cmd.id);
      if (bound && bound === chord) {
        if (editable && !cmd.allowInEditable) continue;
        e.preventDefault();
        e.stopPropagation();
        void cmd.run();
        return true;
      }
    }
    return false;
  },
}));

/**
 * Display helper — turn "Mod+Shift+P" into a platform-appropriate label such
 * as "⌘⇧P" on macOS or "Ctrl+Shift+P" elsewhere.
 */
export function formatChord(chord: string): string {
  if (!chord) return "—";
  const isMac =
    typeof navigator !== "undefined" &&
    /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
  return chord
    .split("+")
    .map((p) => {
      if (p === "Mod") return isMac ? "⌘" : "Ctrl";
      if (p === "Shift") return isMac ? "⇧" : "Shift";
      if (p === "Alt") return isMac ? "⌥" : "Alt";
      return p;
    })
    .join(isMac ? "" : "+");
}
