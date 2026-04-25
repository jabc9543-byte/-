import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { appLocalDataDir, join } from "@tauri-apps/api/path";
import { mkdir, exists } from "@tauri-apps/plugin-fs";
import { useGraphStore } from "../stores/graph";

export function OpenGraphGate() {
  const openGraph = useGraphStore((s) => s.open);
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(false);

  // 自动打开默认 Markdown 图谱目录（位于应用数据目录下的 `graph/`）。
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    (async () => {
      try {
        const base = await appLocalDataDir();
        const dir = await join(base, "graph");
        if (!(await exists(dir))) {
          await mkdir(dir, { recursive: true });
        }
        await openGraph(dir);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [openGraph]);

  const pickFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") await openGraph(selected);
  };

  const pickSqlite = async () => {
    const selected = await open({
      directory: false,
      multiple: false,
      filters: [{ name: "SQLite", extensions: ["db", "sqlite"] }],
    });
    if (typeof selected === "string") await openGraph(selected);
  };

  return (
    <div className="gate">
      <h1>全视维</h1>
      <p>正在打开默认图谱…</p>
      {error && (
        <>
          <p style={{ color: "#c33" }}>自动打开失败：{error}</p>
          <div className="actions">
            <button className="primary" onClick={pickFolder}>
              打开 Markdown 文件夹
            </button>
            <button onClick={pickSqlite}>打开 SQLite 图谱…</button>
          </div>
        </>
      )}
    </div>
  );
}
