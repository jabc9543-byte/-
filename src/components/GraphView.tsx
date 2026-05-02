import { useEffect, useRef, useState } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import { api } from "../api";
import type { GraphStats } from "../types";
import { usePageStore } from "../stores/page";
import { useWhiteboardStore } from "../stores/whiteboard";
import { useIsTouch } from "../hooks/useMediaQuery";

interface SimNode extends SimulationNodeDatum {
  id: string;
  name: string;
  weight: number;
  is_journal: boolean;
  r: number;
}

type SimLink = SimulationLinkDatum<SimNode> & { weight: number };

interface GraphViewProps {
  /** 若指定，则只显示该页面 N 跳内的相关节点（页面图谱模式）。 */
  focusPageId?: string;
  /** 邻域跳数，默认 2。 */
  focusDepth?: number;
}

/**
 * Force-directed page-reference graph.
 *
 * Renders to a full-size canvas for performance; clicking a node opens the
 * corresponding page. Drag a node to reposition (temporarily pinned).
 */
export function GraphView({ focusPageId, focusDepth = 2 }: GraphViewProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isTouch = useIsTouch();
  const openPage = usePageStore((s) => s.openPage);
  const showPage = useWhiteboardStore((s) => s.showPage);

  useEffect(() => {
    let alive = true;
    api
      .graphStats()
      .then((s) => alive && setStats(s))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!stats) return;
    const canvas = canvasRef.current;
    const wrap = wrapperRef.current;
    if (!canvas || !wrap) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = wrap;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();

    const width = () => canvas.width / dpr;
    const height = () => canvas.height / dpr;

    // 若为页面图谱模式，按 BFS 跳数过滤子图
    let subsetIds: Set<string> | null = null;
    if (focusPageId) {
      const adj = new Map<string, Set<string>>();
      for (const n of stats.nodes) adj.set(n.id, new Set());
      for (const e of stats.edges) {
        adj.get(e.source)?.add(e.target);
        adj.get(e.target)?.add(e.source);
      }
      subsetIds = new Set<string>();
      if (adj.has(focusPageId)) {
        let frontier = new Set<string>([focusPageId]);
        subsetIds.add(focusPageId);
        for (let hop = 0; hop < focusDepth; hop++) {
          const next = new Set<string>();
          for (const id of frontier) {
            for (const nb of adj.get(id) ?? []) {
              if (!subsetIds.has(nb)) {
                subsetIds.add(nb);
                next.add(nb);
              }
            }
          }
          if (next.size === 0) break;
          frontier = next;
        }
      } else {
        subsetIds.add(focusPageId);
      }
    }

    const filteredStatsNodes = subsetIds
      ? stats.nodes.filter((n) => subsetIds!.has(n.id))
      : stats.nodes;
    const filteredStatsEdges = subsetIds
      ? stats.edges.filter(
          (e) => subsetIds!.has(e.source) && subsetIds!.has(e.target),
        )
      : stats.edges;

    const maxWeight = Math.max(1, ...filteredStatsNodes.map((n) => n.weight));
    const nodes: SimNode[] = filteredStatsNodes.map((n) => ({
      id: n.id,
      name: n.name,
      weight: n.weight,
      is_journal: n.is_journal,
      r: 4 + Math.sqrt(n.weight / maxWeight) * 14,
    }));
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = filteredStatsEdges
      .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map((e) => ({
        source: nodeMap.get(e.source)!,
        target: nodeMap.get(e.target)!,
        weight: e.weight,
      }));

    const sim = forceSimulation<SimNode>(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance((l) => 40 + 60 / Math.max(1, l.weight))
          .strength(0.2),
      )
      .force("charge", forceManyBody<SimNode>().strength(-120))
      .force("center", forceCenter(width() / 2, height() / 2))
      .force("collide", forceCollide<SimNode>().radius((d) => d.r + 2));

    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    let hoverNode: SimNode | null = null;
    let draggingNode: SimNode | null = null;
    let camX = 0;
    let camY = 0;
    let zoom = 1;

    const toWorld = (px: number, py: number) => ({
      x: (px - camX) / zoom,
      y: (py - camY) / zoom,
    });

    const draw = () => {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width(), height());
      ctx.translate(camX, camY);
      ctx.scale(zoom, zoom);

      // edges
      ctx.strokeStyle = "rgba(120,120,140,0.35)";
      ctx.lineWidth = 0.8;
      for (const l of links) {
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(t.x!, t.y!);
        ctx.stroke();
      }

      // nodes
      for (const n of nodes) {
        const isHover = hoverNode === n;
        const isFocus = focusPageId === n.id;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2);
        ctx.fillStyle = n.is_journal ? "#8b5cf6" : "#3b82f6";
        if (isFocus) ctx.fillStyle = "#10b981";
        if (isHover) ctx.fillStyle = "#f59e0b";
        ctx.fill();
        if (isFocus) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#059669";
          ctx.stroke();
        }
        if (isTouch || isFocus || isHover || n.r > 10) {
          ctx.fillStyle = "rgba(20,20,30,0.9)";
          const fontSize = isTouch
            ? Math.max(9, Math.min(12, 8 + n.r / 4))
            : Math.max(10, Math.min(14, 9 + n.r / 4));
          ctx.font = `${fontSize}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          const label = isTouch && n.name.length > 12
            ? `${n.name.slice(0, 12)}…`
            : n.name;
          ctx.fillText(label, n.x!, n.y! + n.r + 2);
        }
      }
      ctx.restore();
    };

    sim.on("tick", draw);

    const findNode = (px: number, py: number): SimNode | null => {
      const { x, y } = toWorld(px, py);
      for (const n of nodes) {
        const dx = n.x! - x;
        const dy = n.y! - y;
        if (dx * dx + dy * dy <= n.r * n.r) return n;
      }
      return null;
    };

    const onMoveAt = (px: number, py: number) => {
      if (draggingNode) {
        const { x, y } = toWorld(px, py);
        draggingNode.fx = x;
        draggingNode.fy = y;
        sim.alphaTarget(0.3).restart();
        return;
      }
      const prev = hoverNode;
      hoverNode = findNode(px, py);
      canvas.style.cursor = hoverNode ? "pointer" : "default";
      if (prev !== hoverNode) draw();
    };

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      onMoveAt(e.clientX - rect.left, e.clientY - rect.top);
    };

    let panStart: { x: number; y: number; camX: number; camY: number } | null = null;
    const onDownAt = (px: number, py: number) => {
      const n = findNode(px, py);
      if (n) {
        draggingNode = n;
        n.fx = n.x;
        n.fy = n.y;
      } else {
        panStart = { x: px, y: py, camX, camY };
      }
    };
    const onDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      onDownAt(e.clientX - rect.left, e.clientY - rect.top);
    };
    const onUpAt = (px: number, py: number) => {
      if (draggingNode) {
        const node = draggingNode;
        draggingNode = null;
        sim.alphaTarget(0);
        // release pin after a moment so the layout can re-settle
        setTimeout(() => {
          node.fx = null;
          node.fy = null;
        }, 800);
      } else if (panStart) {
        const moved = Math.hypot(px - panStart.x, py - panStart.y);
        if (moved < 4) {
          const clicked = findNode(px, py);
          if (clicked) {
            showPage();
            openPage(clicked.id);
          }
        }
        panStart = null;
      }
    };
    const onUp = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      onUpAt(e.clientX - rect.left, e.clientY - rect.top);
    };
    const onPan = (e: MouseEvent) => {
      if (!panStart) return;
      const rect = canvas.getBoundingClientRect();
      camX = panStart.camX + (e.clientX - rect.left - panStart.x);
      camY = panStart.camY + (e.clientY - rect.top - panStart.y);
      draw();
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      onDownAt(touch.clientX - rect.left, touch.clientY - rect.top);
      e.preventDefault();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      const px = touch.clientX - rect.left;
      const py = touch.clientY - rect.top;
      if (draggingNode) {
        onMoveAt(px, py);
      } else if (panStart) {
        camX = panStart.camX + (px - panStart.x);
        camY = panStart.camY + (py - panStart.y);
        draw();
      } else {
        onMoveAt(px, py);
      }
      e.preventDefault();
    };
    const onTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (!touch) return;
      const rect = canvas.getBoundingClientRect();
      onUpAt(touch.clientX - rect.left, touch.clientY - rect.top);
      e.preventDefault();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const before = toWorld(px, py);
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoom = Math.max(0.2, Math.min(4, zoom * factor));
      camX = px - before.x * zoom;
      camY = py - before.y * zoom;
      draw();
    };

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mousemove", onPan);
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const onResize = () => {
      resize();
      sim.force("center", forceCenter(width() / 2, height() / 2));
      sim.alpha(0.3).restart();
    };
    window.addEventListener("resize", onResize);

    return () => {
      sim.stop();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mousemove", onPan);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onResize);
    };
  }, [stats, openPage, showPage, focusPageId, focusDepth, isTouch]);

  if (error) return <div className="graph-error">图谱加载出错：{error}</div>;
  if (!stats)
    return <div className="graph-loading">正在构建引用图谱…</div>;

  return (
    <div className="graph-view" ref={wrapperRef}>
      <canvas ref={canvasRef} />
      <div className="graph-legend">
        {focusPageId && (
          <div><span className="dot focus" /> 当前页面</div>
        )}
        <div><span className="dot page" /> 页面</div>
        <div><span className="dot journal" /> 日志</div>
        <div className="graph-meta">
          {focusPageId ? `页面图谱 · ${focusDepth} 跳` : null}
          {focusPageId ? " · " : ""}
          {stats.nodes.length} 个节点 · {stats.edges.length} 条连线
        </div>
      </div>
    </div>
  );
}
