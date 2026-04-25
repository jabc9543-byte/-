import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { BlockHistoryEntry } from "../types";
import { usePageStore } from "../stores/page";
import { useHistoryPanelStore } from "../stores/history";

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

/** Minimal line-level diff. Returns rows annotated as add/del/eq. */
function diffLines(a: string, b: string): { kind: "eq" | "add" | "del"; text: string }[] {
  const la = a.split("\n");
  const lb = b.split("\n");
  const n = la.length;
  const m = lb.length;
  // LCS table.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = la[i] === lb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: { kind: "eq" | "add" | "del"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (la[i] === lb[j]) {
      out.push({ kind: "eq", text: la[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", text: la[i] });
      i++;
    } else {
      out.push({ kind: "add", text: lb[j] });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", text: la[i++] });
  while (j < m) out.push({ kind: "add", text: lb[j++] });
  return out;
}

export function BlockHistoryPanel() {
  const blockId = useHistoryPanelStore((s) => s.blockId);
  const close = useHistoryPanelStore((s) => s.close);
  const blocks = usePageStore((s) => s.blocks);
  const activePageId = usePageStore((s) => s.activePageId);
  const openPage = usePageStore((s) => s.openPage);

  const currentBlock = useMemo(
    () => (blockId ? blocks.find((b) => b.id === blockId) ?? null : null),
    [blockId, blocks],
  );

  const [entries, setEntries] = useState<BlockHistoryEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!blockId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .blockHistory(blockId)
      .then((list) => {
        if (cancelled) return;
        setEntries(list);
        setSelectedId(list[0]?.id ?? null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [blockId]);

  if (!blockId) return null;

  const selected = entries.find((e) => e.id === selectedId) ?? null;
  const currentContent = currentBlock?.content ?? "";
  const diff = selected ? diffLines(selected.content, currentContent) : [];

  const onRestore = async () => {
    if (!selected || !blockId) return;
    setBusy(true);
    try {
      await api.restoreBlockVersion(blockId, selected.id);
      if (activePageId) {
        await openPage(activePageId);
      }
      // Re-fetch history so the just-captured pre-restore snapshot appears.
      const list = await api.blockHistory(blockId);
      setEntries(list);
      setSelectedId(list[0]?.id ?? null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cmdp-backdrop" onClick={close}>
      <div
        className="block-history-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="块历史"
      >
        <header className="block-history-header">
          <h2>块历史</h2>
          <button
            className="block-history-close"
            onClick={close}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        {loading && <div className="block-history-status">加载中…</div>}
        {error && <div className="block-history-status block-history-error">{error}</div>}
        {!loading && !error && entries.length === 0 && (
          <div className="block-history-status">
            尚无历史版本。编辑后将自动记录。
          </div>
        )}

        {entries.length > 0 && (
          <div className="block-history-body">
            <ul className="block-history-list" role="listbox">
              {entries.map((e) => (
                <li
                  key={e.id}
                  role="option"
                  aria-selected={e.id === selectedId}
                  className={`block-history-entry${
                    e.id === selectedId ? " block-history-entry-active" : ""
                  }`}
                  onClick={() => setSelectedId(e.id)}
                >
                  <div className="block-history-entry-ts">{formatTs(e.recorded_at)}</div>
                  <div className="block-history-entry-preview">
                    {e.content.split("\n")[0].slice(0, 80) || "（空）"}
                  </div>
                </li>
              ))}
            </ul>

            <div className="block-history-detail">
              <div className="block-history-detail-header">
                <span>
                  {selected
                    ? `差异对比当前版本 — ${formatTs(selected.recorded_at)}`
                    : "请选择一个版本"}
                </span>
                <button
                  className="block-history-restore"
                  onClick={onRestore}
                  disabled={!selected || busy}
                >
                  {busy ? "恢复中…" : "恢复到此版本"}
                </button>
              </div>
              <pre className="block-history-diff">
                {diff.map((row, i) => (
                  <div
                    key={i}
                    className={`block-history-diff-row block-history-diff-${row.kind}`}
                  >
                    <span className="block-history-diff-sign">
                      {row.kind === "add" ? "+" : row.kind === "del" ? "-" : " "}
                    </span>
                    <span className="block-history-diff-text">{row.text || " "}</span>
                  </div>
                ))}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
