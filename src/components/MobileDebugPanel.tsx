import { useEffect, useState } from "react";
import {
  clearMobileDebug,
  formatMobileDebugEntries,
  getMobileDebugEntries,
  logMobileDebug,
  subscribeMobileDebug,
  type MobileDebugEntry,
} from "../utils/mobileDebug";

export function MobileDebugPanel() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<MobileDebugEntry[]>(() => getMobileDebugEntries());

  useEffect(() => subscribeMobileDebug(() => setEntries(getMobileDebugEntries())), []);

  const onCopy = async () => {
    const text = formatMobileDebugEntries(entries);
    try {
      await navigator.clipboard.writeText(text);
      logMobileDebug("debug-panel", "copied logs", { count: entries.length });
    } catch {
      logMobileDebug("debug-panel", "copy failed", { count: entries.length });
      window.alert(text || "暂无日志");
    }
  };

  return (
    <>
      <button
        type="button"
        className="mobile-debug-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-label="打开移动调试日志"
      >
        调试
      </button>
      {open && (
        <div className="mobile-debug-sheet" role="dialog" aria-label="移动调试日志">
          <div className="mobile-debug-header">
            <strong>移动调试日志</strong>
            <div className="mobile-debug-actions">
              <button type="button" onClick={onCopy}>复制</button>
              <button
                type="button"
                onClick={() => {
                  clearMobileDebug();
                  logMobileDebug("debug-panel", "cleared logs");
                }}
              >
                清空
              </button>
              <button type="button" onClick={() => setOpen(false)} aria-label="关闭移动调试日志">
                ×
              </button>
            </div>
          </div>
          <div className="mobile-debug-help">
            复现一次后打开这里，把最新几行复制给我。
          </div>
          <pre className="mobile-debug-log">
            {entries.length === 0 ? "暂无日志" : formatMobileDebugEntries(entries)}
          </pre>
        </div>
      )}
    </>
  );
}
