import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useGraphStore } from "../stores/graph";
import { api } from "../api";

/** 图谱切换下拉菜单：显示最近图谱列表，支持打开文件夹 / SQLite / 切换当前图谱。 */
export function AddGraphMenu() {
  const graph = useGraphStore((s) => s.graph);
  const openGraph = useGraphStore((s) => s.open);
  const [open_, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open_) return;
    api
      .listGraphs()
      .then((list) => setRecent(list))
      .catch(() => setRecent([]));
  }, [open_]);

  useEffect(() => {
    if (!open_) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open_]);

  const pickFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      await openGraph(selected);
      setOpen(false);
    }
  };

  const pickSqlite = async () => {
    const selected = await open({
      directory: false,
      multiple: false,
      filters: [{ name: "SQLite", extensions: ["db", "sqlite"] }],
    });
    if (typeof selected === "string") {
      await openGraph(selected);
      setOpen(false);
    }
  };

  const switchTo = async (path: string) => {
    if (path === graph?.root) {
      setOpen(false);
      return;
    }
    await openGraph(path);
    setOpen(false);
  };

  const labelFor = (path: string) => {
    const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts[parts.length - 1] ?? path;
  };

  return (
    <div className="graph-menu" ref={rootRef}>
      <button
        className="graph-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        title="添加 / 切换图谱"
        aria-label="添加或切换图谱"
        aria-expanded={open_}
      >
        ▾
      </button>
      {open_ && (
        <div className="graph-menu-dropdown" role="menu">
          {recent.length > 0 && (
            <>
              <div className="graph-menu-section">最近图谱</div>
              {recent.map((p) => (
                <button
                  key={p}
                  className={`graph-menu-item${p === graph?.root ? " active" : ""}`}
                  onClick={() => switchTo(p)}
                  title={p}
                >
                  <span className="graph-menu-item-name">{labelFor(p)}</span>
                  <span className="graph-menu-item-path">{p}</span>
                </button>
              ))}
              <div className="graph-menu-sep" />
            </>
          )}
          <button className="graph-menu-item" onClick={pickFolder}>
            ＋ 添加 Markdown 文件夹…
          </button>
          <button className="graph-menu-item" onClick={pickSqlite}>
            ＋ 添加 SQLite 图谱…
          </button>
        </div>
      )}
    </div>
  );
}
