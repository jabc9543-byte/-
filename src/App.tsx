import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Workspace } from "./components/Workspace";
import { OpenGraphGate } from "./components/OpenGraphGate";
import { useGraphStore } from "./stores/graph";
import { usePageStore } from "./stores/page";
import { useWhiteboardStore } from "./stores/whiteboard";

export default function App() {
  const graph = useGraphStore((s) => s.graph);
  const hydrate = useGraphStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!graph) return;
    let disposed = false;
    const unlistenP = listen<string[]>("graph:changed", async () => {
      if (disposed) return;
      const page = usePageStore.getState();
      const wb = useWhiteboardStore.getState();
      await page.refreshPages();
      await wb.refreshList();
      const active = usePageStore.getState().activePageId;
      if (active) await page.openPage(active);
    });
    return () => {
      disposed = true;
      unlistenP.then((fn) => fn()).catch(() => {});
    };
  }, [graph]);

  return graph ? <Workspace /> : <OpenGraphGate />;
}
