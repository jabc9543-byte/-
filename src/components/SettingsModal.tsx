import { useSettingsStore } from "../stores/settings";
import { useCollabStore } from "../stores/collab";
import { useGraphStore } from "../stores/graph";
import { KeymapEditor } from "./KeymapEditor";
import { UpdateSection } from "./UpdateSection";
import { EncryptionSection } from "./EncryptionSection";
import { BackupSection } from "./BackupSection";
import { AiSection } from "./AiSection";

interface Props {
  onClose: () => void;
}

export function SettingsModal({ onClose }: Props) {
  const spellcheck = useSettingsStore((s) => s.spellcheck);
  const toggleSpellcheck = useSettingsStore((s) => s.toggleSpellcheck);
  const collab = useSettingsStore((s) => s.collab);
  const setCollab = useSettingsStore((s) => s.setCollab);
  const toggleCollab = useSettingsStore((s) => s.toggleCollab);
  const collabStatus = useCollabStore((s) => s.status);
  const collabError = useCollabStore((s) => s.error);
  const peerCount = useCollabStore((s) => s.peers.length);
  const graph = useGraphStore((s) => s.graph);
  const start = useCollabStore((s) => s.start);
  const stop = useCollabStore((s) => s.stop);

  const reconnect = () => {
    if (!graph) return;
    stop();
    start({
      room: graph.name,
      serverUrl: collab.serverUrl,
      name: collab.displayName,
      color: collab.color,
    });
  };

  return (
    <div className="settings-modal">
      <header className="settings-header">
        <h2>设置</h2>
        <button className="settings-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </header>

      <section className="settings-section">
        <h3>编辑器</h3>
        <label className="settings-row">
          <input
            type="checkbox"
            checked={spellcheck}
            onChange={toggleSpellcheck}
          />
          <span>在块编辑器中启用拼写检查</span>
        </label>
      </section>

      <section className="settings-section">
        <h3>协作</h3>
        <label className="settings-row">
          <input
            type="checkbox"
            checked={collab.enabled}
            onChange={toggleCollab}
          />
          <span>启用实时协作（Y.js）</span>
        </label>

        <label className="settings-row settings-row-col">
          <span>WebSocket 服务器 URL</span>
          <input
            type="text"
            value={collab.serverUrl}
            onChange={(e) => setCollab({ serverUrl: e.target.value })}
            placeholder="ws://localhost:1234"
          />
        </label>

        <label className="settings-row settings-row-col">
          <span>显示名称</span>
          <input
            type="text"
            value={collab.displayName}
            onChange={(e) => setCollab({ displayName: e.target.value })}
            placeholder="您的名字"
          />
        </label>

        <label className="settings-row settings-row-col">
          <span>光标颜色</span>
          <input
            type="color"
            value={collab.color}
            onChange={(e) => setCollab({ color: e.target.value })}
          />
        </label>

        <div className="settings-status">
          <span className={`settings-status-dot status-${collabStatus}`} />
          <span>
            {collabStatus === "connected" && `已连接 · ${peerCount} 位协作者`}
            {collabStatus === "connecting" && "连接中…"}
            {collabStatus === "disconnected" && "已断开"}
            {collabStatus === "disabled" && "未运行"}
            {collabStatus === "error" && `错误：${collabError ?? "未知"}`}
          </span>
          {graph && collab.enabled && (
            <button className="settings-reconnect" onClick={reconnect}>
              重新连接
            </button>
          )}
        </div>

        <p className="settings-hint">
          在上方 URL 运行任意兼容 y-websocket 的服务器（如 <code>npx y-websocket</code>）。
          当前图谱名称（<code>{graph?.name ?? "n/a"}</code>）将被用作协作房间。
        </p>
      </section>

      <section className="settings-section">
        <h3>键盘快捷键</h3>
        <KeymapEditor />
      </section>

      <UpdateSection />
      <EncryptionSection />
      <BackupSection />
      <AiSection />
    </div>
  );
}

export function CollabPresence() {
  const status = useCollabStore((s) => s.status);
  const peers = useCollabStore((s) => s.peers);
  if (status === "disabled") return null;
  return (
    <div className="collab-presence" title={`协作状态：${status}`}>
      <span className={`collab-dot status-${status}`} />
      {peers.map((p) => (
        <span
          key={p.clientId}
          className="collab-avatar"
          style={{ background: p.color }}
          title={p.name}
        >
          {p.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
    </div>
  );
}
