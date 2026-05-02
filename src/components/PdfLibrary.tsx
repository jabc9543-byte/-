import { useEffect, useRef, useState } from "react";
import { usePdfStore } from "../stores/pdf";
import { PdfViewer } from "./PdfViewer";

export function PdfLibrary({ onClose }: { onClose: () => void }) {
  const list = usePdfStore((s) => s.list);
  const activeId = usePdfStore((s) => s.activeId);
  const refresh = usePdfStore((s) => s.refresh);
  const openPdf = usePdfStore((s) => s.open);
  const importBytes = usePdfStore((s) => s.importBytes);
  const remove = usePdfStore((s) => s.remove);
  const importZotero = usePdfStore((s) => s.importZotero);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const bibInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const onPickPdf = () => pdfInputRef.current?.click();

  const onPdfSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const asset = await importBytes(file.name, bytes);
      await openPdf(asset.id);
      setStatus(`已导入 ${asset.name}`);
    } catch (e) {
      setStatus(`导入失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const onPickBib = () => bibInputRef.current?.click();

  const onBibSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const content = await file.text();
      const report = await importZotero(content);
      setStatus(
        `Zotero：从 ${report.entries_seen} 条条目创建了 ${report.pages_created} 个页面。`,
      );
    } catch (err) {
      setStatus(`Zotero 导入失败：${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`pdf-library${activeId ? " has-active" : ""}`}>
      <div className="pdf-library-sidebar">
        <div className="pdf-library-header">
          <strong>PDF / Zotero</strong>
          <button className="pdf-close" onClick={onClose} title="关闭">×</button>
        </div>
        <div className="pdf-library-actions">
          <button disabled={busy} onClick={onPickPdf}>📄 导入 PDF…</button>
          <button disabled={busy} onClick={onPickBib}>📚 导入 BibTeX…</button>
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf,application/pdf"
            style={{ display: "none" }}
            onChange={onPdfSelected}
          />
          <input
            ref={bibInputRef}
            type="file"
            accept=".bib,.bibtex,text/plain"
            style={{ display: "none" }}
            onChange={onBibSelected}
          />
        </div>
        {status && <div className="pdf-library-status">{status}</div>}
        <ul className="pdf-library-list">
          {list.length === 0 && (
            <li className="pdf-library-empty">尚未导入 PDF。</li>
          )}
          {list.map((p) => (
            <li
              key={p.id}
              className={`pdf-library-item${activeId === p.id ? " active" : ""}`}
            >
              <button
                className="pdf-library-open"
                onClick={() => openPdf(p.id)}
                title={p.filename}
              >
                <span className="pdf-library-name">{p.name}</span>
                <span className="pdf-library-meta">
                  {(p.size / 1024).toFixed(0)} KB
                </span>
              </button>
              <button
                className="pdf-library-delete"
                onClick={async () => {
                  if (confirm(`删除 ${p.name}？`)) await remove(p.id);
                }}
                title="删除"
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="pdf-library-main">
        {activeId ? (
          <>
            <div className="pdf-library-main-header">
              <button
                type="button"
                className="pdf-viewer-back"
                onClick={() => openPdf(null)}
                title="返回列表"
                aria-label="返回列表"
              >
                ←
              </button>
            </div>
            <PdfViewer pdfId={activeId} />
          </>
        ) : (
          <div className="pdf-library-placeholder">
            请在左侧选择一个 PDF，或导入新文件。
          </div>
        )}
      </div>
    </div>
  );
}
