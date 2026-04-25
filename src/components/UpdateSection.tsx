import { useEffect, useState } from "react";
import { api } from "../api";
import type { AppVersionInfo, UpdateInfo } from "../types";

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "uptodate" }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "error"; message: string };

/**
 * "About & Updates" section for the Settings modal. Shows the current
 * version and lets the user manually poll the updater endpoint.
 */
export function UpdateSection() {
  const [info, setInfo] = useState<AppVersionInfo | null>(null);
  const [state, setState] = useState<CheckState>({ kind: "idle" });
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    api.appVersion().then(setInfo).catch(() => {});
  }, []);

  const check = async () => {
    setState({ kind: "checking" });
    try {
      const u = await api.checkForUpdate();
      setState(u ? { kind: "available", info: u } : { kind: "uptodate" });
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  };

  const install = async () => {
    setInstalling(true);
    try {
      await api.installUpdate();
    } catch (e) {
      setState({ kind: "error", message: String(e) });
      setInstalling(false);
    }
  };

  return (
    <section className="settings-section">
      <h3>关于与更新</h3>
      <div className="settings-row settings-row-col">
        <span>版本</span>
        <div className="settings-about">
          <code>{info?.version ?? "…"}</code>
          <span className="settings-about-meta">
            Tauri {info?.tauri_version ?? ""} · {info?.identifier ?? ""}
          </span>
        </div>
      </div>

      <div className="settings-update-row">
        <button
          className="settings-check-btn"
          onClick={check}
          disabled={state.kind === "checking" || installing}
        >
          {state.kind === "checking" ? "检查中…" : "检查更新"}
        </button>

        {state.kind === "uptodate" && (
          <span className="settings-update-ok">已是最新版本。</span>
        )}

        {state.kind === "error" && (
          <span className="settings-update-err">{state.message}</span>
        )}

        {state.kind === "available" && (
          <div className="settings-update-ok">
            发现新版本 <strong>{state.info.version}</strong>。
            <button
              className="settings-check-btn primary"
              onClick={install}
              disabled={installing}
              style={{ marginLeft: 8 }}
            >
              {installing ? "安装中…" : "安装并重启"}
            </button>
          </div>
        )}
      </div>

      {state.kind === "available" && state.info.notes && (
        <pre className="update-banner-notes">{state.info.notes}</pre>
      )}
    </section>
  );
}
