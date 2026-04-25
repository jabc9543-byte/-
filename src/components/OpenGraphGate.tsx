import { open } from "@tauri-apps/plugin-dialog";
import { useGraphStore } from "../stores/graph";

export function OpenGraphGate() {
  const openGraph = useGraphStore((s) => s.open);

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
      <p>
        基于 Rust + Tauri + React 构建的本地优先知识图谱。
        打开一个已有的 Markdown 文件夹，或选择一个 SQLite 图谱文件。
      </p>
      <div className="actions">
        <button className="primary" onClick={pickFolder}>
          打开 Markdown 文件夹
        </button>
        <button onClick={pickSqlite}>打开 SQLite 图谱…</button>
      </div>
    </div>
  );
}
