import { useState } from "react";
import { useEncryptionStore } from "../stores/encryption";

type Mode = "status" | "enable" | "change" | "disable";

/**
 * Settings panel section for managing the current graph's encryption.
 */
export function EncryptionSection() {
  const status = useEncryptionStore((s) => s.status);
  const loading = useEncryptionStore((s) => s.loading);
  const error = useEncryptionStore((s) => s.error);
  const enable = useEncryptionStore((s) => s.enable);
  const lock = useEncryptionStore((s) => s.lock);
  const changePass = useEncryptionStore((s) => s.changePassphrase);
  const disable = useEncryptionStore((s) => s.disable);

  const [mode, setMode] = useState<Mode>("status");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [pOld, setPOld] = useState("");

  const reset = () => {
    setP1("");
    setP2("");
    setPOld("");
    setMode("status");
  };

  const enabled = !!status?.enabled;
  const unlocked = !!status?.unlocked;

  const onEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (p1.length < 8) return;
    if (p1 !== p2) return;
    try {
      await enable(p1);
      reset();
    } catch {
      /* error surfaced via store */
    }
  };

  const onChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pOld || p1.length < 8 || p1 !== p2) return;
    try {
      await changePass(pOld, p1);
      reset();
    } catch {
      /* noop */
    }
  };

  const onDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pOld) return;
    try {
      await disable(pOld);
      reset();
    } catch {
      /* noop */
    }
  };

  return (
    <section className="settings-section">
      <h3>端到端加密</h3>
      <div className="settings-status">
        <span
          className={`settings-status-dot ${
            enabled ? (unlocked ? "status-connected" : "status-error") : ""
          }`}
        />
        <span>
          {enabled
            ? unlocked
              ? "已启用 — 已解锁"
              : "已启用 — 已锁定"
            : "未启用"}
        </span>
      </div>

      {!enabled && mode !== "enable" && (
        <>
          <p className="settings-hint">
            使用您掌控的密码短语，对图谱中每个块进行静态加密。
            采用 XChaCha20-Poly1305 加密，密钥通过 Argon2id 派生。
          </p>
          <button className="settings-reconnect" onClick={() => setMode("enable")}>
            启用加密…
          </button>
        </>
      )}

      {!enabled && mode === "enable" && (
        <form onSubmit={onEnable} className="encryption-form">
          <p className="settings-hint">
            设置密码短语（至少 8 位）。如果忘记，数据将无法恢复。
          </p>
          <input
            type="password"
            placeholder="密码短语"
            value={p1}
            onChange={(e) => setP1(e.target.value)}
            autoFocus
          />
          <input
            type="password"
            placeholder="确认密码短语"
            value={p2}
            onChange={(e) => setP2(e.target.value)}
          />
          {p2.length > 0 && p1 !== p2 && (
            <div className="encryption-error">两次输入不一致。</div>
          )}
          <div className="encryption-actions">
            <button
              type="submit"
              className="encryption-primary"
              disabled={loading || p1.length < 8 || p1 !== p2}
            >
              {loading ? "启用中…" : "启用"}
            </button>
            <button
              type="button"
              className="encryption-secondary"
              onClick={reset}
            >
              取消
            </button>
          </div>
        </form>
      )}

      {enabled && unlocked && mode === "status" && (
        <div className="encryption-actions">
          <button className="settings-reconnect" onClick={() => void lock()}>
            立即锁定
          </button>
          <button
            className="settings-reconnect"
            onClick={() => setMode("change")}
          >
            更改密码…
          </button>
          <button
            className="settings-reconnect encryption-danger"
            onClick={() => setMode("disable")}
          >
            禁用加密…
          </button>
        </div>
      )}

      {enabled && unlocked && mode === "change" && (
        <form onSubmit={onChange} className="encryption-form">
          <input
            type="password"
            placeholder="当前密码短语"
            value={pOld}
            onChange={(e) => setPOld(e.target.value)}
            autoFocus
          />
          <input
            type="password"
            placeholder="新密码短语"
            value={p1}
            onChange={(e) => setP1(e.target.value)}
          />
          <input
            type="password"
            placeholder="确认新密码短语"
            value={p2}
            onChange={(e) => setP2(e.target.value)}
          />
          {p2.length > 0 && p1 !== p2 && (
            <div className="encryption-error">两次输入不一致。</div>
          )}
          <div className="encryption-actions">
            <button
              type="submit"
              className="encryption-primary"
              disabled={loading || !pOld || p1.length < 8 || p1 !== p2}
            >
              {loading ? "换密钥中…" : "更改"}
            </button>
            <button
              type="button"
              className="encryption-secondary"
              onClick={reset}
            >
              取消
            </button>
          </div>
        </form>
      )}

      {enabled && unlocked && mode === "disable" && (
        <form onSubmit={onDisable} className="encryption-form">
          <p className="settings-hint">
            禁用加密会将每个块写回明文。请输入密码短语确认。
          </p>
          <input
            type="password"
            placeholder="当前密码短语"
            value={pOld}
            onChange={(e) => setPOld(e.target.value)}
            autoFocus
          />
          <div className="encryption-actions">
            <button
              type="submit"
              className="encryption-primary encryption-danger"
              disabled={loading || !pOld}
            >
              {loading ? "禁用中…" : "禁用"}
            </button>
            <button
              type="button"
              className="encryption-secondary"
              onClick={reset}
            >
              取消
            </button>
          </div>
        </form>
      )}

      {error && <div className="encryption-error">{error}</div>}
    </section>
  );
}
