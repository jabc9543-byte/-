// Singleton registry for the currently-focused mobile block editor.
// The mobile on-screen toolbar uses this to invoke selection-aware
// actions (wrap with **, etc.) on whatever textarea is focused, while
// store-level actions (indent/outdent/move/insertSibling/cycleTask)
// are dispatched against the active block id.

export interface MobileEditorApi {
  blockId: string;
  pageId: string | null;
  textarea: HTMLTextAreaElement;
  /** Wrap current selection with prefix/suffix and persist via onChange. */
  wrap: (prefix: string, suffix?: string) => void;
  /** Read latest content from the DOM. */
  getValue: () => string;
  /** Persist current value via the page store (no-op if unchanged). */
  flush: () => Promise<void>;
}

let active: MobileEditorApi | null = null;
const listeners = new Set<() => void>();

export function setActiveMobileEditor(api: MobileEditorApi | null) {
  active = api;
  for (const l of listeners) l();
}

export function getActiveMobileEditor(): MobileEditorApi | null {
  return active;
}

export function subscribeMobileEditor(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
