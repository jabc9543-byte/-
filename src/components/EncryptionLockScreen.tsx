import { useState } from "react";
import { useEncryptionStore } from "../stores/encryption";

/**
 * Full-screen gate shown when the current graph has encryption enabled but
 * the vault is locked. Blocks all other workspace interaction until the
 * user supplies a valid passphrase.
 */
export function EncryptionLockScreen() {
  const unlock = useEncryptionStore((s) => s.unlock);
  const lock = useEncryptionStore((s) => s.lock);
  const loading = useEncryptionStore((s) => s.loading);
  const error = useEncryptionStore((s) => s.error);
  const [pass, setPass] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pass) return;
    try {
      await unlock(pass);
      setPass("");
    } catch {
      // error is exposed via the store.
    }
  };

  return (
    <div className="encryption-gate">
      <form className="encryption-card" onSubmit={onSubmit}>
        <div className="encryption-icon" aria-hidden>
          🔒
        </div>
        <h2>图谱已锁定</h2>
        <p className="encryption-hint">
          此图谱已端到端加密。请输入密码短语以解锁。
        </p>
        <input
          className="encryption-input"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder="密码短语"
        />
        {error && <div className="encryption-error">{error}</div>}
        <div className="encryption-actions">
          <button
            type="submit"
            className="encryption-primary"
            disabled={loading || !pass}
          >
            {loading ? "解锁中…" : "解锁"}
          </button>
          <button
            type="button"
            className="encryption-secondary"
            onClick={() => void lock()}
            title="取消并保持图谱锁定"
          >
            锁定
          </button>
        </div>
        <p className="encryption-footnote">
          密码短语始终保存在本设备中。如果忘记，将无法恢复图谱内的块。
        </p>
      </form>
    </div>
  );
}
