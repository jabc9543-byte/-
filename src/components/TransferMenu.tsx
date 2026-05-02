import { useState } from "react";
import { save, open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { usePageStore } from "../stores/page";
import { useWhiteboardStore } from "../stores/whiteboard";
import { pickMarkdownFiles } from "../utils/mobilePermissions";

type Status =
  | { kind: "idle" }
  | { kind: "busy"; label: string }
  | { kind: "ok"; label: string }
  | { kind: "err"; label: string };

export function TransferMenu() {
  const [open_, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const refreshPages = usePageStore((s) => s.refreshPages);
  const refreshWhiteboards = useWhiteboardStore((s) => s.refreshList);

  const wrap = async <T,>(label: string, fn: () => Promise<T>) => {
    setStatus({ kind: "busy", label });
    try {
      await fn();
      setStatus({ kind: "ok", label });
      setTimeout(() => setStatus({ kind: "idle" }), 2500);
    } catch (e) {
      setStatus({ kind: "err", label: `${label}: ${(e as Error).message ?? e}` });
    }
  };

  const onExportZip = async () => {
    const path = await save({
      defaultPath: "graph-export.zip",
      filters: [{ name: "Zip", extensions: ["zip"] }],
    });
    if (!path) return;
    await wrap("导出 Markdown", async () => {
      const r = await api.exportMarkdown(path);
      setStatus({
        kind: "ok",
        label: `已导出 ${r.pages} 页面、${r.blocks} 块、${r.whiteboards} 白板`,
      });
      setTimeout(() => setStatus({ kind: "idle" }), 3500);
    });
    setOpen(false);
  };

  const onExportJson = async () => {
    const path = await save({
      defaultPath: "graph-export.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    await wrap("导出 JSON", async () => {
      const r = await api.exportJson(path);
      setStatus({
        kind: "ok",
        label: `已导出 ${r.pages} 页面、${r.blocks} 块`,
      });
      setTimeout(() => setStatus({ kind: "idle" }), 3500);
    });
    setOpen(false);
  };

  const onExportOpml = async () => {
    const path = await save({
      defaultPath: "graph-export.opml",
      filters: [{ name: "OPML", extensions: ["opml", "xml"] }],
    });
    if (!path) return;
    await wrap("导出 OPML", async () => {
      const r = await api.exportOpml(path);
      setStatus({
        kind: "ok",
        label: `已导出 ${r.pages} 页面、${r.blocks} 块`,
      });
      setTimeout(() => setStatus({ kind: "idle" }), 3500);
    });
    setOpen(false);
  };

  const onExportActivePage = async () => {
    const active = usePageStore.getState().activePageId;
    const pages = usePageStore.getState().pages;
    const page = pages.find((p) => p.id === active);
    if (!active || !page) {
      setStatus({ kind: "err", label: "没有可导出的当前页面" });
      setTimeout(() => setStatus({ kind: "idle" }), 3000);
      return;
    }
    const path = await save({
      defaultPath: `${page.name.replace(/[\\/:*?"<>|]/g, "_")}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return;
    await wrap("导出页面", async () => {
      const r = await api.exportPageMarkdown(active, path);
      setStatus({
        kind: "ok",
        label: `已导出 ${page.name}（${r.blocks} 块）`,
      });
      setTimeout(() => setStatus({ kind: "idle" }), 3500);
    });
    setOpen(false);
  };

  const onImport = async () => {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Graph archive", extensions: ["zip"] }],
    });
    const path = typeof picked === "string" ? picked : null;
    if (!path) return;
    await wrap("导入 Markdown", async () => {
      const r = await api.importMarkdown(path);
      await refreshPages();
      await refreshWhiteboards();
      setStatus({
        kind: "ok",
        label: `已导入 ${r.pages} 页面、${r.blocks} 块`,
      });
      setTimeout(() => setStatus({ kind: "idle" }), 3500);
    });
    setOpen(false);
  };

  const onImportMarkdownFiles = async () => {
    const files = await pickMarkdownFiles();
    if (files.length === 0) return;
    await wrap("导入 Markdown 文件", async () => {
      let pages = 0;
      let blocks = 0;
      for (const file of files) {
        const content = await file.text();
        const result = await api.importMarkdownFile(file.name, content);
        pages += result.pages;
        blocks += result.blocks;
      }
      await refreshPages();
      await refreshWhiteboards();
      setStatus({
        kind: "ok",
        label: `已导入 ${pages} 页面、${blocks} 块`,
      });
      setTimeout(() => setStatus({ kind: "idle" }), 3500);
    });
    setOpen(false);
  };

  const onImportDir = async () => {
    const picked = await open({ multiple: false, directory: true });
    const path = typeof picked === "string" ? picked : null;
    if (!path) return;
    await wrap("导入文件夹", async () => {
      const r = await api.importMarkdown(path);
      await refreshPages();
      await refreshWhiteboards();
      setStatus({
        kind: "ok",
        label: `已导入 ${r.pages} 页面、${r.blocks} 块`,
      });
      setTimeout(() => setStatus({ kind: "idle" }), 3500);
    });
    setOpen(false);
  };

  const onImportJson = async () => {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    const path = typeof picked === "string" ? picked : null;
    if (!path) return;
    await wrap("导入 JSON", async () => {
      const r = await api.importJson(path);
      await refreshPages();
      await refreshWhiteboards();
      setStatus({
        kind: "ok",
        label: `已导入 ${r.pages} 页面、${r.blocks} 块`,
      });
      setTimeout(() => setStatus({ kind: "idle" }), 3500);
    });
    setOpen(false);
  };

  const onImportOpml = async () => {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "OPML", extensions: ["opml", "xml"] }],
    });
    const path = typeof picked === "string" ? picked : null;
    if (!path) return;
    await wrap("导入 OPML", async () => {
      const r = await api.importOpml(path);
      await refreshPages();
      setStatus({
        kind: "ok",
        label: `已导入 ${r.pages} 页面、${r.blocks} 块`,
      });
      setTimeout(() => setStatus({ kind: "idle" }), 3500);
    });
    setOpen(false);
  };

  return (
    <div className="transfer-menu">
      <button onClick={() => setOpen((v) => !v)}>传输 ▾</button>
      {open_ && (
        <div className="transfer-popover" onMouseLeave={() => setOpen(false)}>
          <div className="transfer-section">导出</div>
          <button onClick={onExportZip}>图谱 → Markdown ZIP</button>
          <button onClick={onExportJson}>图谱 → JSON</button>
          <button onClick={onExportOpml}>图谱 → OPML</button>
          <button onClick={onExportActivePage}>当前页面 → Markdown</button>
          <div className="transfer-divider" />
          <div className="transfer-section">导入</div>
          <button onClick={onImportMarkdownFiles}>Markdown 文件…</button>
          <button onClick={onImport}>Markdown ZIP…</button>
          <button onClick={onImportDir}>全视维 / Logseq 图谱文件夹…</button>
          <button onClick={onImportJson}>JSON 转储…</button>
          <button onClick={onImportOpml}>OPML 大纲…</button>
        </div>
      )}
      {status.kind !== "idle" && (
        <span
          className={`transfer-status transfer-${status.kind}`}
          title={status.label}
        >
          {status.kind === "busy" ? "…" : status.kind === "ok" ? "✓" : "!"}{" "}
          {status.label}
        </span>
      )}
    </div>
  );
}
