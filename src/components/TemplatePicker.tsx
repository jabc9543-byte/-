import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { TemplateInfo } from "../types";
import { usePageStore } from "../stores/page";

interface Props {
  onClose: () => void;
}

/**
 * Modal for inserting a block template into the active page. Lists every
 * `template:: NAME` block in the graph, prompts for any user-defined
 * variables, then deep-copies the subtree as new top-level blocks at the
 * bottom of the current page.
 */
export function TemplatePicker({ onClose }: Props) {
  const activePageId = usePageStore((s) => s.activePageId);
  const blocks = usePageStore((s) => s.blocks);
  const openPage = usePageStore((s) => s.openPage);

  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<TemplateInfo | null>(null);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [inserting, setInserting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .listTemplates()
      .then((list) => setTemplates(list))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.page_name.toLowerCase().includes(q),
    );
  }, [templates, filter]);

  const selectTemplate = (t: TemplateInfo) => {
    setSelected(t);
    const fresh: Record<string, string> = {};
    for (const v of t.variables) fresh[v] = "";
    setVars(fresh);
  };

  const doInsert = async () => {
    if (!selected || !activePageId) return;
    setInserting(true);
    setError(null);
    try {
      // Append at end: pick the last root block as anchor and insert as sibling
      // (i.e. below it). If the page is empty, target_block = null.
      const roots = blocks.filter((b) => !b.parent_id);
      const anchor = roots.length > 0 ? roots[roots.length - 1].id : null;
      await api.insertTemplate(
        selected.id,
        activePageId,
        anchor,
        false,
        vars,
      );
      await openPage(activePageId);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setInserting(false);
    }
  };

  return (
    <div className="cmdp-backdrop" onClick={onClose}>
      <div
        className="template-picker"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>插入模板</h2>
          <button className="settings-close" onClick={onClose}>×</button>
        </header>

        {!selected && (
          <>
            <input
              className="template-filter"
              placeholder="搜索模板…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
            />
            {loading ? (
              <div className="template-empty">加载中…</div>
            ) : filtered.length === 0 ? (
              <div className="template-empty">
                未找到模板。在任何块中添加{" "}
                <code>template:: NAME</code> 即可创建。
              </div>
            ) : (
              <ul className="template-list">
                {filtered.map((t) => (
                  <li
                    key={t.id}
                    className="template-item"
                    onClick={() => selectTemplate(t)}
                  >
                    <div className="template-name">{t.name}</div>
                    <div className="template-meta">
                      <span className="template-page">{t.page_name}</span>
                      {t.variables.length > 0 && (
                        <span className="template-vars">
                          {t.variables.length} 个变量
                        </span>
                      )}
                    </div>
                    {t.preview && (
                      <div className="template-preview">{t.preview}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {selected && (
          <div className="template-form">
            <button
              className="template-back"
              onClick={() => setSelected(null)}
            >
              ← 返回
            </button>
            <h3>{selected.name}</h3>
            <div className="template-meta">
              来自 <span className="template-page">{selected.page_name}</span>
            </div>
            {selected.variables.length === 0 ? (
              <p className="settings-hint">无需填写变量。</p>
            ) : (
              <div className="template-vars-grid">
                {selected.variables.map((v) => (
                  <label key={v} className="template-var">
                    <span>{v}</span>
                    <input
                      value={vars[v] ?? ""}
                      onChange={(e) =>
                        setVars((old) => ({ ...old, [v]: e.target.value }))
                      }
                      autoFocus={v === selected.variables[0]}
                    />
                  </label>
                ))}
              </div>
            )}
            {error && <div className="template-error">{error}</div>}
            <div className="template-actions">
              <button onClick={onClose}>取消</button>
              <button
                className="primary"
                disabled={inserting || !activePageId}
                onClick={doInsert}
              >
                {inserting ? "插入中…" : "插入"}
              </button>
            </div>
            {!activePageId && (
              <p className="settings-hint">请先打开一个页面。</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
