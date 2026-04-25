import { useEffect, useState } from "react";
import { api } from "../api";
import type { Block } from "../types";
import { usePageStore } from "../stores/page";

interface Props {
  query: string;
}

/**
 * Renders a Logseq-style `{{query ...}}` embed: runs the query against the
 * active graph and shows matching blocks as a compact list. Re-runs whenever
 * the query text changes.
 */
export function QueryEmbed({ query }: Props) {
  const [hits, setHits] = useState<Block[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const openPage = usePageStore((s) => s.openPage);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .runQuery(query)
      .then((r) => {
        if (!cancelled) setHits(r);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <div className="query-embed">
      <div className="query-embed-header">
        <span className="query-embed-label">查询</span>
        <code>{query}</code>
        <span className="query-embed-count">
          {loading ? "…" : `${hits.length} 条结果`}
        </span>
      </div>
      {error && <div className="query-embed-error">{error}</div>}
      {!error && hits.length > 0 && (
        <ul className="query-embed-hits">
          {hits.map((b) => (
            <li key={b.id}>
              <a className="page-link" onClick={() => openPage(b.page_id)}>
                {b.page_id}
              </a>
              <span> · </span>
              <span>{b.content.split("\n")[0]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
