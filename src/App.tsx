import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { Workspace } from "./components/Workspace";
import { OpenGraphGate } from "./components/OpenGraphGate";
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
    await page.refreshPages();
    await wb.refreshList();
    const active = usePageStore.getState().activePageId;
    if (active) {
      logMobileDebug("graph.reload", reason, { activePageId: active });
      await page.openPage(active);
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
      return;
    }
    clearReloadTimer();
    reloadTimer.current = window.setTimeout(async () => {
      reloadTimer.current = null;
      if (shouldHoldGraphReload()) {
        pendingGraphReload.current = true;
        return;
      }
      if (reloadInFlight.current) {
        pendingGraphReload.current = true;
        return;
      }
      reloadInFlight.current = true;
      const runReason = queuedReloadReason.current;
      try {
        await reloadActiveGraphViews(runReason);
      } finally {
        reloadInFlight.current = false;
        if (pendingGraphReload.current && !shouldHoldGraphReload()) {
          pendingGraphReload.current = false;
          scheduleReload("flush deferred graph:changed");
        }
      }
    }, 250);
  };

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!graph) return;

    const flushDeferredReload = () => {
      if (!pendingGraphReload.current) return;
      if (shouldHoldGraphReload()) return;
      pendingGraphReload.current = false;
      scheduleReload("flush deferred graph:changed");
    };

    const onFocusOut = () => {
      window.setTimeout(flushDeferredReload, 0);
    };

    window.addEventListener("focusout", onFocusOut, true);
    window.addEventListener("visibilitychange", flushDeferredReload);
    const unsubscribePendingWrites = usePageStore.subscribe((state, prevState) => {
      if (state.pendingBlockWrites === 0 && prevState.pendingBlockWrites > 0) {
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

  return graph ? <Workspace /> : <OpenGraphGate />;
}
