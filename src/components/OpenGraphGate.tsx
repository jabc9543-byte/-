import { useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { api } from "../api";
import { useGraphStore } from "../stores/graph";
import { useIsMobile } from "../hooks/useMediaQuery";
import { pickMarkdownFiles } from "../utils/mobilePermissions";

export function OpenGraphGate() {
  const openGraph = useGraphStore((s) => s.open);
  const isMobile = useIsMobile();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const defaultDirRef = useRef<string | null>(null);

  const ensureDefaultGraph = async () => {
    const dir = defaultDirRef.current ?? await invoke<string>("default_graph_dir");
    defaultDirRef.current = dir;
    await openGraph(dir);
    return dir;
  };

  // 桌面端：弹出系统文件夹选择对话框
  const pickFolder = async () => {
    setError(null);
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        await openGraph(selected);
      } else {
        setError(
          "未选择文件夹。如果你在手机上，系统不支持选择任意文件夹，请点击下方“使用默认工作区”。",
        );
      }
    } catch (e) {
      setError(
        `打开文件夹失败：${String(e)}。如果你在手机上，请改用“使用默认工作区”。`,
      );
    }
  };

  const pickSqlite = async () => {
    setError(null);
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        filters: [{ name: "SQLite", extensions: ["db", "sqlite"] }],
      });
      if (typeof selected === "string") await openGraph(selected);
    } catch (e) {
      setError(`打开 SQLite 失败：${String(e)}`);
    }
  };

  // 任意平台（尤其是 Android）：在应用沙盒里创建/打开默认 Markdown 工作区
  const useDefault = async () => {
    setError(null);
    setBusy(true);
    try {
      await ensureDefaultGraph();
    } catch (e) {
      setError(`创建默认工作区失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const importMarkdownFiles = async () => {
    setError(null);
    setBusy(true);
    try {
      const files = await pickMarkdownFiles();
      if (files.length === 0) {
        setBusy(false);
        return;
      }
      await ensureDefaultGraph();
      for (const file of files) {
        const content = await file.text();
        await api.importMarkdownFile(file.name, content);
      }
    } catch (e) {
      setError(`导入 Markdown 文件失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate">
      <h1>全视维</h1>
      <p>请选择要打开的图谱：</p>
      <div className="actions">
        {isMobile ? (
          <button className="primary" onClick={importMarkdownFiles} disabled={busy}>
            导入 Markdown 文件
          </button>
        ) : (
          <button className="primary" onClick={pickFolder} disabled={busy}>
            打开 Markdown 文件夹
          </button>
        )}
        <button onClick={pickSqlite} disabled={busy}>
          打开 SQLite 图谱…
        </button>
        <button onClick={useDefault} disabled={busy}>
          使用默认工作区（手机推荐）
        </button>
      </div>
      <p style={{ marginTop: 16, color: "#888", fontSize: 12 }}>
        提示：Android 上会把选中的 Markdown 文件导入到应用默认工作区；
        桌面端仍然支持直接打开整个 Markdown 图谱文件夹。
      </p>
      {error && <p style={{ color: "#c33" }}>{error}</p>}
    </div>
  );
}
