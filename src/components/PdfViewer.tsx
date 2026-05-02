import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
// Use the bundled worker so no CDN fetch is needed.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — Vite ?url import for the worker script.
import PdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { nanoid } from "nanoid";
import { usePdfStore } from "../stores/pdf";
import type { PdfAnnotation, PdfStroke } from "../api";

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker as string;

const COLORS = ["yellow", "green", "blue", "pink", "orange"] as const;
type Color = (typeof COLORS)[number];

// Hex codes for SVG stroke rendering. We can't reach the CSS variables
// from inside the inline SVG so duplicate them here.
const COLOR_HEX: Record<Color, string> = {
  yellow: "#f5c518",
  green: "#3fb950",
  blue: "#3a8dde",
  pink: "#e85aad",
  orange: "#ff8c42",
};

type Tool = "pen" | "rect";

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
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [color, setColor] = useState<Color>("yellow");
  const [tool, setTool] = useState<Tool>("pen");
  const [activeAnnotation, setActiveAnnotation] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(() =>
    typeof window === "undefined" ? 800 : window.innerWidth,
  );

  // Track the visible width of the PDF column so each page can be
  // rendered at the correct scale (especially important on phones).
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const update = () => {
      const w = node.clientWidth;
      if (w > 0) setContainerWidth(w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  // Load PDF from Rust backend as bytes.
  useEffect(() => {
    let cancelled = false;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
    (async () => {
      setPages([]);
      docRef.current = null;
      const { api } = await import("../api");
      const bytes = await api.readPdfBytes(pdfId);
      if (cancelled) return;
      const data = new Uint8Array(bytes);
      loadingTask = pdfjsLib.getDocument({ data });
      const doc = await loadingTask.promise;
      if (cancelled) return;
      docRef.current = doc;
      const dims: RenderedPage[] = [];
      const targetWidth = Math.max(280, containerWidth - 16);
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = targetWidth / baseViewport.width;
        const viewport = page.getViewport({ scale });
        dims.push({
          pageNumber: i,
          width: viewport.width,
          height: viewport.height,
        });
      }
      if (cancelled) return;
      setPages(dims);
    })().catch((e) => console.error("PDF load failed", e));
    return () => {
      cancelled = true;
      loadingTask?.destroy().catch(() => {});
      pagesRef.current.clear();
    };
  }, [pdfId, containerWidth]);

  // Render canvases after pages state commits to the DOM. This is a
  // separate effect because the previous queueMicrotask path raced
  // ahead of React's commit and the canvas hosts didn't exist yet —
  // resulting in blank pages on first load (especially on Android).
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || pages.length === 0) return;
    let cancelled = false;
    const renderTasks: Array<{ cancel: () => void }> = [];
    (async () => {
      const targetWidth = Math.max(280, containerWidth - 16);
      for (const p of pages) {
        if (cancelled) return;
        const host = pagesRef.current.get(p.pageNumber);
        if (!host) continue;
        const canvas = host.querySelector("canvas") as
          | HTMLCanvasElement
          | null;
        if (!canvas) continue;
        const page = await doc.getPage(p.pageNumber);
        if (cancelled) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = targetWidth / baseViewport.width;
        const viewport = page.getViewport({ scale });
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = viewport.width + "px";
        canvas.style.height = viewport.height + "px";
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        const task = page.render({ canvasContext: ctx, viewport });
        renderTasks.push(task);
        try {
          await task.promise;
        } catch (err) {
          if (!cancelled) console.error("PDF page render failed", p.pageNumber, err);
        }
      }
    })();
    return () => {
      cancelled = true;
      for (const t of renderTasks) {
        try {
          t.cancel();
        } catch {
          /* ignore */
        }
      }
    };
  }, [pages, containerWidth]);

  // --- Drag-to-annotate (pen / rect) ---
  type DragState =
    | {
        kind: "rect";
        page: number;
        startX: number;
        startY: number;
        rect: HTMLDivElement;
      }
    | {
        kind: "pen";
        page: number;
        points: { x: number; y: number }[];
        polyline: SVGPolylineElement;
        svg: SVGSVGElement;
      };
  const dragRef = useRef<DragState | null>(null);
  const toolRef = useRef<Tool>(tool);
  const colorRef = useRef<Color>(color);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  useEffect(() => {
    colorRef.current = color;
  }, [color]);

  const onMouseDown = useCallback(
    (e: React.PointerEvent, pageNumber: number) => {
      // Allow drags that start on the page itself, on its child
      // canvas, or on existing pen-stroke svg layers (which are
      // pointer-events: none, but defensive). Highlight rectangles
      // already call stopPropagation so they don't reach this.
      const target = e.target as HTMLElement;
      if (
        target !== e.currentTarget &&
        target.tagName !== "CANVAS" &&
        !(target instanceof SVGElement) &&
        !target.classList.contains("pdf-page-number")
      ) {
        return;
      }
      const host = e.currentTarget as HTMLDivElement;
      const box = host.getBoundingClientRect();
      const startX = e.clientX - box.left;
      const startY = e.clientY - box.top;
      try {
        host.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (toolRef.current === "pen") {
        // Build an absolute-positioned SVG overlay covering the page.
        const svgNs = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNs, "svg") as SVGSVGElement;
        svg.classList.add("pdf-pen-live");
        svg.setAttribute("width", String(box.width));
        svg.setAttribute("height", String(box.height));
        svg.style.position = "absolute";
        svg.style.left = "0";
        svg.style.top = "0";
        svg.style.pointerEvents = "none";
        const polyline = document.createElementNS(
          svgNs,
          "polyline",
        ) as SVGPolylineElement;
        polyline.setAttribute("fill", "none");
        polyline.setAttribute("stroke", COLOR_HEX[colorRef.current]);
        polyline.setAttribute("stroke-width", "3");
        polyline.setAttribute("stroke-linecap", "round");
        polyline.setAttribute("stroke-linejoin", "round");
        polyline.setAttribute("points", `${startX},${startY}`);
        svg.appendChild(polyline);
        host.appendChild(svg);
        dragRef.current = {
          kind: "pen",
          page: pageNumber,
          points: [{ x: startX, y: startY }],
          polyline,
          svg,
        };
      } else {
        const rect = document.createElement("div");
        rect.className = "pdf-drag-rect";
        rect.style.left = startX + "px";
        rect.style.top = startY + "px";
        host.appendChild(rect);
        dragRef.current = {
          kind: "rect",
          page: pageNumber,
          startX,
          startY,
          rect,
        };
      }
    },
    [],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const host = pagesRef.current.get(d.page);
      if (!host) return;
      const box = host.getBoundingClientRect();
      const curX = e.clientX - box.left;
      const curY = e.clientY - box.top;
      if (d.kind === "rect") {
        const x = Math.min(d.startX, curX);
        const y = Math.min(d.startY, curY);
        const w = Math.abs(curX - d.startX);
        const h = Math.abs(curY - d.startY);
        d.rect.style.left = x + "px";
        d.rect.style.top = y + "px";
        d.rect.style.width = w + "px";
        d.rect.style.height = h + "px";
      } else {
        // Coalesce sub-pixel moves: only push when moved > 1px.
        const last = d.points[d.points.length - 1];
        if (Math.abs(last.x - curX) < 1 && Math.abs(last.y - curY) < 1) return;
        d.points.push({ x: curX, y: curY });
        const pts = d.points.map((p) => `${p.x},${p.y}`).join(" ");
        d.polyline.setAttribute("points", pts);
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      const host = pagesRef.current.get(d.page);
      const pageInfo = pages.find((p) => p.pageNumber === d.page);
      if (!pageInfo || !host) {
        if (d.kind === "rect") d.rect.remove();
        else d.svg.remove();
        return;
      }
      if (d.kind === "rect") {
        const box = host.getBoundingClientRect();
        const r = d.rect.getBoundingClientRect();
        d.rect.remove();
        const w = r.width;
        const h = r.height;
        if (w < 8 || h < 8) return;
        const x = r.left - box.left;
        const y = r.top - box.top;
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
          strokes: [],
          text: "",
          color: colorRef.current,
          note: null,
          created_at: new Date().toISOString(),
        };
        addAnnotation(annotation);
        setActiveAnnotation(annotation.id);
      } else {
        d.svg.remove();
        if (d.points.length < 2) return;
        const stroke: PdfStroke = {
          color: colorRef.current,
          width: 3,
          points: d.points.map((p) => ({
            x: (p.x / pageInfo.width) * 100,
            y: (p.y / pageInfo.height) * 100,
          })),
        };
        const annotation: PdfAnnotation = {
          id: nanoid(10),
          page: d.page,
          rects: [],
          strokes: [stroke],
          text: "",
          color: colorRef.current,
          note: null,
          created_at: new Date().toISOString(),
        };
        addAnnotation(annotation);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [addAnnotation, pages]);

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
    <div className={`pdf-viewer pdf-tool-${tool}`}>
      <div className="pdf-toolbar">
        <button
          type="button"
          className={`pdf-tool-btn${tool === "pen" ? " active" : ""}`}
          onClick={() => setTool("pen")}
          title="画笔（在 PDF 上自由绘制；启用时不能滑动页面）"
          aria-label="画笔"
        >
          🖊 画笔
        </button>
        <button
          type="button"
          className={`pdf-tool-btn${tool === "rect" ? " active" : ""}`}
          onClick={() => setTool("rect")}
          title="矩形高亮"
          aria-label="矩形高亮"
        >
          ▭ 高亮
        </button>
        <span className="pdf-label">颜色：</span>
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
      <div
        className={`pdf-pages${tool === "pen" ? " pdf-pages-pen" : ""}`}
        ref={containerRef}
      >
        {pages.map((p) => (
          <div
            key={p.pageNumber}
            ref={(el) => {
              if (el) pagesRef.current.set(p.pageNumber, el);
              else pagesRef.current.delete(p.pageNumber);
            }}
            className="pdf-page"
            style={{ width: p.width, height: p.height }}
            onPointerDown={(e) => onMouseDown(e, p.pageNumber)}
          >
            <canvas />
            {(byPage.get(p.pageNumber) ?? []).map((a) => (
              <PageAnnotation
                key={a.id}
                annotation={a}
                pageWidth={p.width}
                pageHeight={p.height}
                active={activeAnnotation === a.id}
                onActivate={() => setActiveAnnotation(a.id)}
              />
            ))}
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

function PageAnnotation({
  annotation,
  pageWidth,
  pageHeight,
  active,
  onActivate,
}: {
  annotation: PdfAnnotation;
  pageWidth: number;
  pageHeight: number;
  active: boolean;
  onActivate: () => void;
}) {
  const strokes = annotation.strokes ?? [];
  return (
    <>
      {annotation.rects.map((r, i) => (
        <div
          key={`r-${i}`}
          className={`pdf-highlight pdf-color-${annotation.color}${active ? " active" : ""}`}
          style={{
            left: (r.x / 100) * pageWidth,
            top: (r.y / 100) * pageHeight,
            width: (r.w / 100) * pageWidth,
            height: (r.h / 100) * pageHeight,
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            onActivate();
          }}
          title={annotation.note ?? ""}
        />
      ))}
      {strokes.length > 0 && (
        <svg
          className={`pdf-stroke-layer${active ? " active" : ""}`}
          width={pageWidth}
          height={pageHeight}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            pointerEvents: "none",
          }}
        >
          {strokes.map((s, i) => (
            <polyline
              key={`s-${i}`}
              fill="none"
              stroke={COLOR_HEX[(s.color as Color) ?? annotation.color] ?? COLOR_HEX.yellow}
              strokeWidth={s.width || 3}
              strokeLinecap="round"
              strokeLinejoin="round"
              points={s.points
                .map(
                  (p) =>
                    `${(p.x / 100) * pageWidth},${(p.y / 100) * pageHeight}`,
                )
                .join(" ")}
            />
          ))}
        </svg>
      )}
    </>
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
