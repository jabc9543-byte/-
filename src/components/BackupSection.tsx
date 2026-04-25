import { useEffect, useState } from "react";
import { useBackupStore } from "../stores/backup";
import type { BackupEntry } from "../types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function BackupSection() {
  const entries = useBackupStore((s) => s.entries);
  const config = useBackupStore((s) => s.config);
  const lastRunAt = useBackupStore((s) => s.lastRunAt);
  const loading = useBackupStore((s) => s.loading);
  const busy = useBackupStore((s) => s.busy);
  const error = useBackupStore((s) => s.error);
  const refresh = useBackupStore((s) => s.refresh);
  const setConfig = useBackupStore((s) => s.setConfig);
  const createNow = useBackupStore((s) => s.createNow);
  const remove = useBackupStore((s) => s.remove);
  const restore = useBackupStore((s) => s.restore);

  const [confirmRestore, setConfirmRestore] = useState<BackupEntry | null>(null);
  const [restoredPath, setRestoredPath] = useState<string | null>(null);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const cfg = config ?? { enabled: true, interval_mins: 60, max_keep: 20 };

  const onToggle = () =>
    void setConfig({ ...cfg, enabled: !cfg.enabled });
  const onInterval = (n: number) =>
    void setConfig({ ...cfg, interval_mins: Math.max(5, Math.min(1440, n)) });
  const onKeep = (n: number) =>
    void setConfig({ ...cfg, max_keep: Math.max(0, Math.min(500, n)) });

  const doRestore = async (id: string) => {
    try {
      const path = await restore(id);
      setRestoredPath(path);
    } catch {
      /* error surfaced via store */
    } finally {
      setConfirmRestore(null);
    }
  };

  return (
    <section className="settings-section">
      <h3>自动备份（时光机）</h3>

      <label className="settings-row">
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={onToggle}
          disabled={busy}
        />
        <span>启用定时快照</span>
      </label>

      <label className="settings-row settings-row-col">
        <span>间隔（分钟）</span>
        <input
          type="number"
          min={5}
          max={1440}
          value={cfg.interval_mins}
          onChange={(e) => onInterval(Number(e.target.value))}
          disabled={busy || !cfg.enabled}
        />
      </label>

      <label className="settings-row settings-row-col">
        <span>最多保留（0 = 无限制）</span>
        <input
          type="number"
          min={0}
          max={500}
          value={cfg.max_keep}
          onChange={(e) => onKeep(Number(e.target.value))}
          disabled={busy}
        />
      </label>

      <div className="backup-controls">
        <button
          className="settings-reconnect"
          onClick={() => void createNow()}
          disabled={busy}
        >
          {busy ? "处理中…" : "立即备份"}
        </button>
        <button
          className="settings-reconnect"
          onClick={() => void refresh()}
          disabled={loading}
        >
          刷新列表
        </button>
        {lastRunAt && (
          <span className="settings-hint">
            上次备份：{formatTime(lastRunAt)}
          </span>
        )}
      </div>

      <div className="backup-list">
        {loading && entries.length === 0 && (
          <div className="backup-empty">加载中…</div>
        )}
        {!loading && entries.length === 0 && (
          <div className="backup-empty">尚无快照。</div>
        )}
        {entries.map((e) => (
          <div key={e.id} className="backup-row">
            <div className="backup-row-info">
              <span className={`backup-kind backup-kind-${e.kind}`}>
                {e.kind === "manual" ? "手动" : "自动"}
              </span>
              <span className="backup-time">{formatTime(e.created_at)}</span>
              <span className="backup-size">{formatBytes(e.size)}</span>
            </div>
            <div className="backup-row-actions">
              <button
                className="backup-secondary"
                onClick={() => setConfirmRestore(e)}
                disabled={busy}
              >
                恢复…
              </button>
              <button
                className="backup-danger"
                onClick={() => void remove(e.id)}
                disabled={busy}
                title="删除此快照"
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      {confirmRestore && (
        <div className="backup-confirm">
          <p>
            确认恢复 <strong>{confirmRestore.filename}</strong>？
            系统将在当前图谱旁边解压出一个新的图谱文件夹，
            当前打开的图谱不会被改动。
          </p>
          <div className="backup-controls">
            <button
              className="backup-primary"
              onClick={() => void doRestore(confirmRestore.id)}
              disabled={busy}
            >
              {busy ? "恢复中…" : "恢复"}
            </button>
            <button
              className="backup-secondary"
              onClick={() => setConfirmRestore(null)}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {restoredPath && (
        <div className="backup-confirm">
          <p>
            已恢复至：
            <br />
            <code>{restoredPath}</code>
          </p>
          <button
            className="backup-secondary"
            onClick={() => setRestoredPath(null)}
          >
            知道了
          </button>
        </div>
      )}

      {error && <div className="backup-error">{error}</div>}
    </section>
  );
}
