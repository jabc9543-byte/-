import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { BacklinkGroup, BlockContext } from "../types";
import { usePageStore } from "../stores/page";
import { InlineRefs } from "./InlineRefs";

interface Props {
  onClose: () => void;
}

/**
 * Right-docked panel showing backlinks for the active page, grouped by
 * source page. Each hit displays the ancestor breadcrumb and can be hovered
 * to reveal a preview card with the block's children. Clicking navigates
 * to the source page.
 *
 * The panel refreshes automatically on:
 *   * active page change
 *   * block mutation on the active page (via `blocks` dependency)
 *   * a 5-second poll (catches edits made on other pages / via the watcher)
 *   * window focus
 */
export function BacklinksPanel({ onClose }: Props) {
  const page = usePageStore((s) => s.page);
  const blocks = usePageStore((s) => s.blocks);
  const openPage = usePageStore((s) => s.openPage);

  const [groups, setGroups] = useState<BacklinkGroup[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const mutatingRef = useRef<symbol | null>(null);

  const pageName = page?.name ?? null;

  const refresh = useMemo(
    () => async () => {
      if (!pageName) {
        setGroups([]);
        return;
      }
      const token = Symbol("refresh");
      mutatingRef.current = token;
      setBusy(true);
      try {
        const g = await api.backlinksGrouped(pageName);
        if (mutatingRef.current === token) {
          setGroups(g);
          setError(null);
        }
      } catch (e) {
        if (mutatingRef.current === token) setError(String(e));
      } finally {
        if (mutatingRef.current === token) setBusy(false);
      }
    },
    [pageName],
  );

  useEffect(() => {
    refresh();
  }, [refresh, blocks.length]);

  // Poll while panel is open.
  useEffect(() => {
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Refresh on window focus.
  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const totalHits = groups.reduce((n, g) => n + g.hits.length, 0);

  const filteredGroups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        hits: g.hits.filter(
          (h) =>
            h.block.content.toLowerCase().includes(q) ||
            g.page_name.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.hits.length > 0);
  }, [groups, filter]);

  return (
    <aside className="backlinks-panel">
      <header className="backlinks-header">
        <div>
          <h2>反向链接</h2>
          <div className="backlinks-sub">
            {pageName ? (
              <>
                <span className="backlinks-page">{pageName}</span>
                <span className="backlinks-count">
                  {totalHits} 条引用 · {groups.length} 个页面
                </span>
              </>
            ) : (
              <span className="backlinks-count">未打开页面</span>
            )}
          </div>
        </div>
        <div className="backlinks-actions">
          <button
            onClick={refresh}
            disabled={busy || !pageName}
            title="刷新"
          >
            ↻
          </button>
          <button onClick={onClose} title="关闭">
            ×
          </button>
        </div>
      </header>

      {pageName && (
        <input
          className="backlinks-filter"
          placeholder="筛选引用…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}

      {error && <div className="backlinks-error">{error}</div>}

      <div className="backlinks-body">
        {!pageName && (
          <div className="backlinks-empty">打开一个页面以查看其反向链接。</div>
        )}
        {pageName && totalHits === 0 && !busy && (
          <div className="backlinks-empty">
            尚无页面引用 <strong>{pageName}</strong>。
          </div>
        )}
        {filteredGroups.map((g) => {
          const hidden = collapsed[g.page_id];
          return (
            <section key={g.page_id} className="backlinks-group">
              <header
                className="backlinks-group-head"
                onClick={() =>
                  setCollapsed((c) => ({ ...c, [g.page_id]: !hidden }))
                }
              >
                <span className={`caret ${hidden ? "closed" : "open"}`}>
                  ▸
                </span>
                <a
                  className="page-link"
                  onClick={(e) => {
                    e.stopPropagation();
                    openPage(g.page_id);
                  }}
                >
                  {g.page_name}
                </a>
                <span className="backlinks-group-count">
                  {g.hits.length}
                </span>
                {g.is_journal && (
                  <span className="backlinks-journal">日志</span>
                )}
              </header>
              {!hidden && (
                <ul className="backlinks-hits">
                  {g.hits.map((h) => (
                    <HitItem
                      key={h.block.id}
                      group={g}
                      blockId={h.block.id}
                      content={h.block.content}
                      ancestors={h.ancestors.map((a) => a.content)}
                      onOpen={() => openPage(g.page_id)}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

interface HitProps {
  group: BacklinkGroup;
  blockId: string;
  content: string;
  ancestors: string[];
  onOpen: () => void;
}

function HitItem({ blockId, content, ancestors, onOpen }: HitProps) {
  const [ctx, setCtx] = useState<BlockContext | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(false);
  const [preview, setPreview] = useState(false);
  const hoverTimer = useRef<number | null>(null);

  const schedulePreview = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      setPreview(true);
      if (!ctx && !loadingCtx) {
        setLoadingCtx(true);
        api
          .blockContext(blockId)
          .then((c) => setCtx(c))
          .catch(() => {})
          .finally(() => setLoadingCtx(false));
      }
    }, 220);
  };
  const cancelPreview = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    setPreview(false);
  };

  return (
    <li
      className="backlinks-hit"
      onMouseEnter={schedulePreview}
      onMouseLeave={cancelPreview}
    >
      {ancestors.length > 0 && (
        <div className="backlinks-crumbs">
          {ancestors.map((a, i) => (
            <span key={i} className="crumb">
              {truncate(firstLine(a), 40)}
            </span>
          ))}
        </div>
      )}
      <div className="backlinks-content" onClick={onOpen}>
        {renderInline(content)}
      </div>
      {preview && (
        <div className="backlinks-preview">
          {loadingCtx && <div className="backlinks-preview-loading">加载中…</div>}
          {ctx && (
            <>
              {ctx.ancestors.length > 0 && (
                <div className="backlinks-preview-ancestors">
                  {ctx.ancestors.map((a) => (
                    <div key={a.id} className="backlinks-preview-ancestor">
                      {truncate(firstLine(a.content), 80)}
                    </div>
                  ))}
                </div>
              )}
              <div className="backlinks-preview-body">
                {renderInline(ctx.block.content)}
              </div>
              {ctx.children.length > 0 && (
                <ul className="backlinks-preview-children">
                  {ctx.children.map((c) => (
                    <li key={c.id}>{renderInline(c.content)}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function firstLine(s: string): string {
  const i = s.indexOf("\n");
  return i === -1 ? s : s.slice(0, i);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function renderInline(content: string) {
  return <InlineRefs content={content} />;
}
