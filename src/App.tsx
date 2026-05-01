import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { Workspace } from "./components/Workspace";
import { OpenGraphGate } from "./components/OpenGraphGate";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PermissionDialogHost } from "./components/PermissionDialogHost";
import { useGraphStore } from "./stores/graph";
import { usePageStore } from "./stores/page";
import { useWhiteboardStore } from "./stores/whiteboard";
import { logMobileDebug } from "./utils/mobileDebug";

export default function App() {
  const graph = useGraphStore((s) => s.graph);
  const hydrate = useGraphStore((s) => s.hydrate);
  const pendingGraphReload = useRef(false);
  const reloadInFlight = useRef(false);
  const reloadTimer = useRef<number | null>(null);
  const queuedReloadReason = useRef<string>("graph:changed");

  const shouldHoldGraphReload = () => {
    if (typeof document === "undefined") return false;
    const active = document.activeElement;
    const editorFocused =
      active instanceof HTMLTextAreaElement && active.classList.contains("block-editor");
    return editorFocused || usePageStore.getState().pendingBlockWrites > 0;
  };

  const reloadActiveGraphViews = async (reason: string) => {
    const page = usePageStore.getState();
    const wb = useWhiteboardStore.getState();
    const startedAt = Date.now();
    await page.refreshPages();
    await wb.refreshList();
    const active = usePageStore.getState().activePageId;
    if (active) {
      logMobileDebug("graph.reload", reason, { activePageId: active });
      await page.openPage(active);
      logMobileDebug("graph.reload.done", reason, {
        activePageId: active,
        tookMs: Date.now() - startedAt,
      });
    }
  };

  const clearReloadTimer = () => {
    if (reloadTimer.current !== null) {
      window.clearTimeout(reloadTimer.current);
      reloadTimer.current = null;
    }
  };

  const scheduleReload = (reason: string) => {
    queuedReloadReason.current = reason;
    if (shouldHoldGraphReload()) {
      pendingGraphReload.current = true;
      logMobileDebug("graph.reload.queue", "held before schedule", {
        reason,
        pendingBlockWrites: usePageStore.getState().pendingBlockWrites,
      });
      return;
    }
    clearReloadTimer();
    logMobileDebug("graph.reload.queue", "scheduled", {
      reason,
      pendingBlockWrites: usePageStore.getState().pendingBlockWrites,
    });
    reloadTimer.current = window.setTimeout(async () => {
      reloadTimer.current = null;
      if (shouldHoldGraphReload()) {
        pendingGraphReload.current = true;
        logMobileDebug("graph.reload.queue", "held on timer fire", {
          reason: queuedReloadReason.current,
          pendingBlockWrites: usePageStore.getState().pendingBlockWrites,
        });
        return;
      }
      if (reloadInFlight.current) {
        pendingGraphReload.current = true;
        logMobileDebug("graph.reload.queue", "inflight, defer next", {
          reason: queuedReloadReason.current,
        });
        return;
      }
      reloadInFlight.current = true;
      const runReason = queuedReloadReason.current;
      logMobileDebug("graph.reload.queue", "timer fire", {
        reason: runReason,
        pendingBlockWrites: usePageStore.getState().pendingBlockWrites,
      });
      try {
        await reloadActiveGraphViews(runReason);
      } catch (error) {
        logMobileDebug("graph.reload.error", "reload failed", {
          reason: runReason,
          error: String(error),
        });
        throw error;
      } finally {
        reloadInFlight.current = false;
        if (pendingGraphReload.current && !shouldHoldGraphReload()) {
          pendingGraphReload.current = false;
          logMobileDebug("graph.reload.queue", "flush queued after inflight", {
            reason: runReason,
          });
          scheduleReload("flush deferred graph:changed");
        }
      }
    }, 250);
  };

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      logMobileDebug("window.error", event.message || "unknown error", {
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      logMobileDebug("window.rejection", "unhandled rejection", {
        reason: String(event.reason),
      });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    if (!graph) return;

    const flushDeferredReload = () => {
      if (!pendingGraphReload.current) return;
      if (shouldHoldGraphReload()) {
        logMobileDebug("graph.reload.flush", "still held on flush", {
          pendingBlockWrites: usePageStore.getState().pendingBlockWrites,
        });
        return;
      }
      pendingGraphReload.current = false;
      logMobileDebug("graph.reload.flush", "flush deferred reload", {
        pendingBlockWrites: usePageStore.getState().pendingBlockWrites,
      });
      scheduleReload("flush deferred graph:changed");
    };

    const onFocusOut = () => {
      logMobileDebug("focusout", "window focusout", {
        activeTag: document.activeElement instanceof HTMLElement
          ? document.activeElement.tagName
          : "null",
        pendingBlockWrites: usePageStore.getState().pendingBlockWrites,
      });
      window.setTimeout(flushDeferredReload, 0);
    };

    window.addEventListener("focusout", onFocusOut, true);
    window.addEventListener("visibilitychange", flushDeferredReload);
    const unsubscribePendingWrites = usePageStore.subscribe((state, prevState) => {
      if (state.pendingBlockWrites === 0 && prevState.pendingBlockWrites > 0) {
        logMobileDebug("page.write", "pending writes drained", {
          prev: prevState.pendingBlockWrites,
          next: state.pendingBlockWrites,
        });
        window.setTimeout(flushDeferredReload, 0);
      }
    });
    return () => {
      clearReloadTimer();
      window.removeEventListener("focusout", onFocusOut, true);
      window.removeEventListener("visibilitychange", flushDeferredReload);
      unsubscribePendingWrites();
    };
  }, [graph]);

  useEffect(() => {
    if (!graph) return;
    let disposed = false;
    const unlistenP = listen<string[]>("graph:changed", async (event) => {
      if (disposed) return;
      if (shouldHoldGraphReload()) {
        pendingGraphReload.current = true;
        logMobileDebug("graph:changed", "deferred while editing", {
          pathCount: event.payload?.length ?? 0,
          pendingBlockWrites: usePageStore.getState().pendingBlockWrites,
        });
        return;
      }
      scheduleReload("apply graph:changed immediately");
    });
    return () => {
      disposed = true;
      clearReloadTimer();
      unlistenP.then((fn) => fn()).catch(() => {});
    };
  }, [graph]);

  return (
    <ErrorBoundary>
      {graph ? <Workspace /> : <OpenGraphGate />}
      {!graph && <PermissionDialogHost />}
    </ErrorBoundary>
  );
}
