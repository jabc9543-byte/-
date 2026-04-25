import { useEffect, useMemo, useRef } from "react";
import { Tldraw, createTLStore, defaultShapeUtils, loadSnapshot, getSnapshot, type Editor } from "tldraw";
import "tldraw/tldraw.css";
import { useWhiteboardStore } from "../stores/whiteboard";

interface Props {
  id: string;
}

/**
 * Infinite canvas editor powered by tldraw. The document (all shapes, pages,
 * camera state) is serialized as a single JSON blob and persisted through
 * the Rust backend.
 */
export function WhiteboardView({ id }: Props) {
  const active = useWhiteboardStore((s) => s.active);
  const save = useWhiteboardStore((s) => s.save);
  const open = useWhiteboardStore((s) => s.open);

  useEffect(() => {
    if (!active || active.id !== id) open(id).catch(() => {});
  }, [id, active, open]);

  const store = useMemo(
    () => createTLStore({ shapeUtils: defaultShapeUtils }),
    [id],
  );

  // Load initial snapshot once the whiteboard is fetched.
  const loadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!active || active.id !== id) return;
    if (loadedRef.current === id) return;
    loadedRef.current = id;
    const snap = active.data as any;
    if (snap && typeof snap === "object" && snap.document) {
      try {
        loadSnapshot(store, snap);
      } catch (e) {
        console.warn("[whiteboard] failed to load snapshot", e);
      }
    }
  }, [active, id, store]);

  // Persist on changes, debounced.
  const timer = useRef<number | null>(null);
  const editorRef = useRef<Editor | null>(null);
  useEffect(() => {
    const unsub = store.listen(
      () => {
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          try {
            const snap = getSnapshot(store);
            void save(id, snap);
          } catch (e) {
            console.warn("[whiteboard] save failed", e);
          }
        }, 600);
      },
      { scope: "document", source: "user" },
    );
    return () => {
      unsub();
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [store, id, save]);

  if (!active || active.id !== id) {
    return <div className="whiteboard-loading">正在加载白板…</div>;
  }

  return (
    <div className="whiteboard-canvas">
      <Tldraw
        store={store}
        onMount={(editor) => {
          editorRef.current = editor;
        }}
      />
    </div>
  );
}
