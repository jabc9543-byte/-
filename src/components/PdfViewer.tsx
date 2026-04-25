import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
// Use the bundled worker so no CDN fetch is needed.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — Vite ?url import for the worker script.
import PdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { nanoid } from "nanoid";
import { usePdfStore } from "../stores/pdf";
import type { PdfAnnotation } from "../api";

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker as string;

const COLORS = ["yellow", "green", "blue", "pink", "orange"] as const;
type Color = (typeof COLORS)[number];

interface RenderedPage {
  pageNumber: number;
  width: number;
  height: number;
}

export function PdfViewer({ pdfId }: { pdfId: string }) {
  const annotations = usePdfStore((s) => s.annotations);
  const addAnnotation = usePdfStore((s) => s.addAnnotation);
  const updateAnnotation = usePdfStore((s) => s.updateAnnotation);
  const removeAnnotation = usePdfStore((s) => s.removeAnnotation);

  const containerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [color, setColor] = useState<Color>("yellow");
  const [activeAnnotation, setActiveAnnotation] = useState<string | null>(null);

  // Load PDF from Rust backend as bytes.
  useEffect(() => {
    let cancelled = false;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
    (async () => {
      setPages([]);
      const { api } = await import("../api");
      const bytes = await api.readPdfBytes(pdfId);
      if (cancelled) return;
      const data = new Uint8Array(bytes);
      loadingTask = pdfjsLib.getDocument({ data });
      const doc = await loadingTask.promise;
      if (cancelled) return;
      const dims: RenderedPage[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 1.3 });
        dims.push({ pageNumber: i, width: viewport.width, height: viewport.height });
        // Render into its matching placeholder once the DOM exists.
        queueMicrotask(() => {
          const host = pagesRef.current.get(i);
          if (!host || cancelled) return;
          const canvas = host.querySelector("canvas") as HTMLCanvasElement | null;
          if (!canvas) return;
          const ratio = window.devicePixelRatio || 1;
          canvas.width = viewport.width * ratio;
          canvas.height = viewport.height * ratio;
          canvas.style.width = viewport.width + "px";
          canvas.style.height = viewport.height + "px";
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
          page.render({ canvasContext: ctx, viewport }).promise.catch(() => {});
        });
      }
      setPages(dims);
    })().catch((e) => console.error("PDF load failed", e));
    return () => {
      cancelled = true;
      loadingTask?.destroy().catch(() => {});
      pagesRef.current.clear();
    };
  }, [pdfId]);

  // --- Drag-to-highlight ---
  const dragRef = useRef<{
    page: number;
    startX: number;
    startY: number;
    rect: HTMLDivElement | null;
  } | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent, pageNumber: number) => {
      if (e.button !== 0 || e.target !== e.currentTarget) return;
      const host = e.currentTarget as HTMLDivElement;
      const box = host.getBoundingClientRect();
      const startX = e.clientX - box.left;
      const startY = e.clientY - box.top;
      const rect = document.createElement("div");
      rect.className = "pdf-drag-rect";
      rect.style.left = startX + "px";
      rect.style.top = startY + "px";
      host.appendChild(rect);
      dragRef.current = { page: pageNumber, startX, startY, rect };
    },
    [],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d || !d.rect) return;
      const host = pagesRef.current.get(d.page);
      if (!host) return;
      const box = host.getBoundingClientRect();
      const curX = e.clientX - box.left;
      const curY = e.clientY - box.top;
      const x = Math.min(d.startX, curX);
      const y = Math.min(d.startY, curY);
      const w = Math.abs(curX - d.startX);
      const h = Math.abs(curY - d.startY);
      d.rect.style.left = x + "px";
      d.rect.style.top = y + "px";
      d.rect.style.width = w + "px";
      d.rect.style.height = h + "px";
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d || !d.rect) return;
      const host = pagesRef.current.get(d.page);
      d.rect.remove();
      if (!host) return;
      const box = host.getBoundingClientRect();
      const pageInfo = pages.find((p) => p.pageNumber === d.page);
      if (!pageInfo) return;
      const rect = d.rect.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w < 8 || h < 8) return;
      const x = rect.left - box.left;
      const y = rect.top - box.top;
      // Store as percent coords relative to page dimensions.
      const annotation: PdfAnnotation = {
        id: nanoid(10),
        page: d.page,
        rects: [
          {
            x: (x / pageInfo.width) * 100,
            y: (y / pageInfo.height) * 100,
            w: (w / pageInfo.width) * 100,
            h: (h / pageInfo.height) * 100,
          },
        ],
        text: "",
        color,
        note: null,
        created_at: new Date().toISOString(),
      };
      addAnnotation(annotation);
      setActiveAnnotation(annotation.id);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [addAnnotation, color, pages]);

  const byPage = useMemo(() => {
    const m = new Map<number, PdfAnnotation[]>();
    for (const a of annotations) {
      const arr = m.get(a.page) ?? [];
      arr.push(a);
      m.set(a.page, arr);
    }
    return m;
  }, [annotations]);

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <span className="pdf-label">高亮：</span>
        {COLORS.map((c) => (
          <button
            key={c}
            className={`pdf-color pdf-color-${c}${color === c ? " active" : ""}`}
            onClick={() => setColor(c)}
            aria-label={c}
          />
        ))}
        <span className="pdf-count">{annotations.length} 条批注</span>
      </div>
      <div className="pdf-pages" ref={containerRef}>
        {pages.map((p) => (
          <div
            key={p.pageNumber}
            ref={(el) => {
              if (el) pagesRef.current.set(p.pageNumber, el);
              else pagesRef.current.delete(p.pageNumber);
            }}
            className="pdf-page"
            style={{ width: p.width, height: p.height }}
            onMouseDown={(e) => onMouseDown(e, p.pageNumber)}
          >
            <canvas />
            {(byPage.get(p.pageNumber) ?? []).map((a) =>
              a.rects.map((r, i) => (
                <div
                  key={`${a.id}-${i}`}
                  className={`pdf-highlight pdf-color-${a.color}${activeAnnotation === a.id ? " active" : ""}`}
                  style={{
                    left: (r.x / 100) * p.width,
                    top: (r.y / 100) * p.height,
                    width: (r.w / 100) * p.width,
                    height: (r.h / 100) * p.height,
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setActiveAnnotation(a.id);
                  }}
                  title={a.note ?? ""}
                />
              )),
            )}
            <div className="pdf-page-number">第 {p.pageNumber} 页</div>
          </div>
        ))}
      </div>
      {activeAnnotation && (
        <AnnotationEditor
          annotation={annotations.find((a) => a.id === activeAnnotation) ?? null}
          onChange={(patch) => updateAnnotation(activeAnnotation, patch)}
          onDelete={() => {
            removeAnnotation(activeAnnotation);
            setActiveAnnotation(null);
          }}
          onClose={() => setActiveAnnotation(null)}
        />
      )}
    </div>
  );
}

function AnnotationEditor({
  annotation,
  onChange,
  onDelete,
  onClose,
}: {
  annotation: PdfAnnotation | null;
  onChange: (patch: Partial<PdfAnnotation>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState(annotation?.note ?? "");
  useEffect(() => setNote(annotation?.note ?? ""), [annotation?.id]);
  if (!annotation) return null;
  return (
    <div className="pdf-annotation-editor">
      <div className="pdf-annotation-header">
        <span>第 {annotation.page} 页 — {annotation.color}</span>
        <button onClick={onClose} className="pdf-close">×</button>
      </div>
      <textarea
        className="pdf-annotation-note"
        placeholder="备注…"
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          onChange({ note: e.target.value });
        }}
      />
      <div className="pdf-annotation-actions">
        {COLORS.map((c) => (
          <button
            key={c}
            className={`pdf-color pdf-color-${c}${annotation.color === c ? " active" : ""}`}
            onClick={() => onChange({ color: c })}
            aria-label={c}
          />
        ))}
        <button className="pdf-delete" onClick={onDelete}>删除</button>
      </div>
    </div>
  );
}
