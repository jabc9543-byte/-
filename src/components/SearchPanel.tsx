import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { usePageStore } from "../stores/page";
import { useWhiteboardStore } from "../stores/whiteboard";
import type { SearchHit } from "../types";

type Mode = "keyword" | "semantic" | "similar";

export function SearchPanel() {
  const [mode, setMode] = useState<Mode>("keyword");
  const [query, setQuery] = useState("");
  const [seedId, setSeedId] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const showPage = useWhiteboardStore((s) => s.showPage);
  const openByName = usePageStore((s) => s.openByName);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  // Debounced search — each mode has slightly different semantics but the
  // caller-facing contract is the same: run as the user types, cancel if a
  // newer query comes in.
  useEffect(() => {
    if (mode === "similar") {
      if (!seedId.trim()) {
        setHits([]);
        setElapsedMs(null);
        return;
      }
      setLoading(true);
      const started = performance.now();
      let cancelled = false;
      api
        .similarBlocks(seedId.trim(), 30)
        .then((h) => {
          if (cancelled) return;
          setHits(h);
          setError(null);
          setElapsedMs(Math.round(performance.now() - started));
        })
        .catch((e) => !cancelled && setError(String(e)))
        .finally(() => !cancelled && setLoading(false));
      return () => {
        cancelled = true;
      };
    }

    const q = query.trim();
    if (!q) {
      setHits([]);
      setElapsedMs(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const started = performance.now();
    const handle = window.setTimeout(() => {
      const call =
        mode === "semantic"
          ? api.semanticSearch(q, 50)
          : api.search(q, 50);
      call
        .then((h) => {
          if (cancelled) return;
          setHits(h);
          setError(null);
          setElapsedMs(Math.round(performance.now() - started));
        })
        .catch((e) => !cancelled && setError(String(e)))
        .finally(() => !cancelled && setLoading(false));
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, seedId, mode]);

  const onReindex = async () => {
    setReindexing(true);
    try {
      await api.rebuildSearchIndex();
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setReindexing(false);
    }
  };

  const gotoHit = async (hit: SearchHit) => {
    // The block IDs we return are stable across renames but we need the
    // page to open. page === "" should be rare (only for the seed-by-id
    // case with a removed page).
    showPage();
    if (hit.page) await openByName(hit.page);
    // Scroll to the block after the page paints.
    window.setTimeout(() => {
      const el = document.querySelector(
        `[data-block-id="${hit.block_id}"]`,
      ) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("block-hit-flash");
        window.setTimeout(() => el.classList.remove("block-hit-flash"), 1400);
      }
    }, 60);
  };

  const tokens = useMemo(() => {
    const q = (mode === "similar" ? "" : query).trim().toLowerCase();
    if (!q) return [] as string[];
    return q.split(/\s+/).filter(Boolean);
  }, [query, mode]);

  return (
    <div className="search-panel">
      <header className="search-panel-head">
        <h1>搜索</h1>
        <div className="search-tabs">
          <button
            className={mode === "keyword" ? "active" : ""}
            onClick={() => setMode("keyword")}
          >
            关键词
          </button>
          <button
            className={mode === "semantic" ? "active" : ""}
            onClick={() => setMode("semantic")}
            title="TF-IDF 余弦 — 更模糊，不计顺序"
          >
            语义
          </button>
          <button
            className={mode === "similar" ? "active" : ""}
            onClick={() => setMode("similar")}
            title="查找与指定块 ID 相似的块"
          >
            相似块
          </button>
          <button
            className="search-reindex"
            onClick={onReindex}
            disabled={reindexing}
            title="重建全文索引"
          >
            {reindexing ? "重建中…" : "重建索引"}
          </button>
        </div>
        {mode !== "similar" ? (
          <input
            ref={inputRef}
            className="search-panel-input"
            placeholder={
              mode === "semantic"
                ? "描述您要查找的内容…"
                : "搜索块（BM25、页面名、支持中文）…"
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        ) : (
          <input
            ref={inputRef}
            className="search-panel-input"
            placeholder="块 ID（右键块 → 复制 ID）"
            value={seedId}
            onChange={(e) => setSeedId(e.target.value)}
          />
        )}
        <div className="search-meta">
          {loading && <span>搜索中…</span>}
          {!loading && elapsedMs !== null && (
            <span>
              {hits.length} 条结果 · {elapsedMs} 毫秒
            </span>
          )}
          {error && <span className="search-error">{error}</span>}
        </div>
      </header>

      <ul className="search-hits">
        {hits.length === 0 && !loading && (
          <li className="search-empty">
            {mode === "similar" && !seedId.trim()
              ? "将块 ID 粘贴到上方以查找相似块。"
              : mode !== "similar" && !query.trim()
                ? "开始输入以搜索。"
                : "无匹配项。"}
          </li>
        )}
        {hits.map((hit) => (
          <li
            key={`${hit.block_id}-${hit.page}`}
            className="search-hit"
            onClick={() => gotoHit(hit)}
          >
            <div className="search-hit-head">
              <span className="search-hit-page">{hit.page || "（无页面）"}</span>
              <span className="search-hit-id">{hit.block_id.slice(0, 8)}</span>
            </div>
            <div className="search-hit-snippet">
              {renderSnippet(hit.snippet, tokens)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderSnippet(snippet: string, tokens: string[]) {
  if (!snippet) return null;
  if (tokens.length === 0) return <span>{snippet}</span>;
  // Highlight any occurrence of a query token (case-insensitive). We build
  // one regex with alternation so overlapping matches don't produce
  // duplicate keys.
  const esc = tokens
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean);
  if (esc.length === 0) return <span>{snippet}</span>;
  const re = new RegExp(`(${esc.join("|")})`, "gi");
  const parts = snippet.split(re);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>,
      )}
    </>
  );
}
