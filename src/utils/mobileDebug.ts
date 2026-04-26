export interface MobileDebugEntry {
  id: number;
  ts: number;
  tag: string;
  message: string;
}

const MAX_ENTRIES = 300;
const STORAGE_KEY = "logseq-rs:mobile-debug-log";

let nextId = 1;
let entries: MobileDebugEntry[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore storage failures
  }
}

function load() {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as MobileDebugEntry[];
    if (!Array.isArray(parsed)) return;
    entries = parsed.slice(-MAX_ENTRIES);
    nextId = entries.length > 0 ? Math.max(...entries.map((entry) => entry.id)) + 1 : 1;
  } catch {
    entries = [];
    nextId = 1;
  }
}

load();

function stringifyDetail(detail: unknown): string {
  if (detail === undefined || detail === null) return "";
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

export function logMobileDebug(tag: string, message: string, detail?: unknown) {
  const suffix = stringifyDetail(detail);
  const entry: MobileDebugEntry = {
    id: nextId++,
    ts: Date.now(),
    tag,
    message: suffix ? `${message} ${suffix}` : message,
  };
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), entry];
  persist();
  notify();
}

export function clearMobileDebug() {
  entries = [];
  persist();
  notify();
}

export function getMobileDebugEntries() {
  return entries;
}

export function subscribeMobileDebug(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function formatMobileDebugEntries(list: MobileDebugEntry[]) {
  return list
    .map((entry) => {
      const stamp = new Date(entry.ts).toLocaleTimeString("zh-CN", { hour12: false });
      return `[${stamp}] ${entry.tag} ${entry.message}`;
    })
    .join("\n");
}
