import { useEffect, useState } from "react";
import { api } from "../api";
import type { UpdateInfo } from "../types";

const SILENCED_KEY = "logseq-rs:update-silenced-version";
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * In-app update banner (module 14). Polls the configured updater endpoint
 * at startup and every 6 hours; when a newer version is returned it
 * surfaces a non-modal banner with Install / Release notes / Dismiss
 * actions. Dismissed versions are remembered until a newer one appears.
 */
export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const u = await api.checkForUpdate();
        if (cancelled) return;
        if (!u) {
          setUpdate(null);
          return;
        }
        const silenced = localStorage.getItem(SILENCED_KEY);
        if (silenced === u.version) {
          setUpdate(null);
          return;
        }
        setUpdate(u);
      } catch {
        /* offline / missing endpoint — fail silently */
      }
    };
    // Initial probe after 5s so startup isn't blocked on network.
    const initial = window.setTimeout(poll, 5_000);
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);
    const onManual = () => poll();
    window.addEventListener("logseq-rs:check-update", onManual);
    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("logseq-rs:check-update", onManual);
    };
  }, []);

  if (!update) return null;

  const dismiss = () => {
    localStorage.setItem(SILENCED_KEY, update.version);
    setUpdate(null);
  };

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      await api.installUpdate();
      // The backend restarts the app; we usually don't reach this line.
    } catch (e) {
      setError(String(e));
      setInstalling(false);
    }
  };

  return (
    <div className="update-banner" role="status">
      <div className="update-banner-body">
        <strong>有可用更新</strong>
        <span className="update-banner-ver">
          {update.current_version} → {update.version}
        </span>
        {update.date && (
          <span className="update-banner-date">{update.date}</span>
        )}
      </div>
      <div className="update-banner-actions">
        {update.notes && (
          <button
            className="update-banner-btn"
            onClick={() => setShowNotes((v) => !v)}
          >
            {showNotes ? "隐藏说明" : "说明"}
          </button>
        )}
        <button
          className="update-banner-btn primary"
          onClick={install}
          disabled={installing}
        >
          {installing ? "安装中…" : "安装并重启"}
        </button>
        <button
          className="update-banner-btn"
          onClick={dismiss}
          disabled={installing}
          title="直到下一个版本前隐藏"
        >
          稍后
        </button>
      </div>
      {showNotes && update.notes && (
        <pre className="update-banner-notes">{update.notes}</pre>
      )}
      {error && <div className="update-banner-error">{error}</div>}
    </div>
  );
}
