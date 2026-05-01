// In-app permission confirmation dialog. Components mount
// <PermissionDialogHost /> once, and any code path can call
// `confirmPermission(...)` to await a user's yes/no decision before
// invoking the underlying browser/system permission API.

export interface PermissionRequest {
  title: string;
  description: string;
  details?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Optional storage key — if provided, an "always allow" decision
   *  will be remembered in localStorage and skipped next time. */
  rememberKey?: string;
}

interface PendingRequest extends PermissionRequest {
  resolve: (granted: boolean) => void;
}

let current: PendingRequest | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function subscribePermissionDialog(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getCurrentPermissionRequest(): PendingRequest | null {
  return current;
}

export function confirmPermission(req: PermissionRequest): Promise<boolean> {
  if (req.rememberKey) {
    try {
      const remembered = localStorage.getItem(`logseq-rs:perm:${req.rememberKey}`);
      if (remembered === "1") return Promise.resolve(true);
    } catch {
      /* ignore */
    }
  }
  // If a request is already pending, queue this one after it resolves.
  if (current) {
    return new Promise((resolve) => {
      const wait = () => {
        if (!current) {
          listeners.delete(wait);
          confirmPermission(req).then(resolve);
        }
      };
      listeners.add(wait);
    });
  }
  return new Promise((resolve) => {
    current = { ...req, resolve };
    notify();
  });
}

export function resolvePermission(granted: boolean, remember = false) {
  if (!current) return;
  if (granted && remember && current.rememberKey) {
    try {
      localStorage.setItem(`logseq-rs:perm:${current.rememberKey}`, "1");
    } catch {
      /* ignore */
    }
  }
  const r = current;
  current = null;
  r.resolve(granted);
  notify();
}
