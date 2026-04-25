import { useEffect, useRef, useState } from "react";
import { useAiStore } from "../stores/ai";

interface AiPanelProps {
  onClose: () => void;
}

const PRESETS: { label: string; prompt: string }[] = [
  {
    label: "总结",
    prompt: "请用 3-5 个要点总结以下笔记：\n\n",
  },
  {
    label: "优化表述",
    prompt:
      "请在保留原意的前提下优化以下文本的清晰度与行文。仅返回修订后的文本：\n\n",
  },
  {
    label: "翻译成英文",
    prompt:
      "请将以下文本翻译为地道的英文，仅返回译文：\n\n",
  },
  {
    label: "继续写作",
    prompt:
      "请以相同的口吻和 Markdown 格式继续写作，仅返回续写内容：\n\n",
  },
];

export function AiPanel({ onClose }: AiPanelProps) {
  const turns = useAiStore((s) => s.turns);
  const busy = useAiStore((s) => s.busy);
  const error = useAiStore((s) => s.error);
  const config = useAiStore((s) => s.config);
  const refreshConfig = useAiStore((s) => s.refreshConfig);
  const ask = useAiStore((s) => s.ask);
  const cancel = useAiStore((s) => s.cancel);
  const reset = useAiStore((s) => s.reset);

  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!config) refreshConfig().catch(() => {});
  }, [config, refreshConfig]);

  useEffect(() => {
    // Auto-scroll on each turn update.
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    ask(text).catch(() => {});
  };

  const enabled = config?.enabled && config?.has_api_key;
  const placeholder = enabled
    ? "向 AI 助手提问…（Enter 发送，Shift+Enter 换行）"
    : "请先在设置中配置接口和 API 密钥以启用 AI。";

  return (
    <aside className="ai-panel" role="dialog" aria-label="AI 助手">
      <header className="ai-panel-header">
        <strong>AI 助手</strong>
        <div className="ai-panel-header-actions">
          <button
            className="ai-secondary"
            onClick={reset}
            disabled={turns.length === 0 || busy}
            title="清空对话"
          >
            清空
          </button>
          <button
            className="ai-secondary"
            onClick={onClose}
            aria-label="关闭 AI 面板"
          >
            ×
          </button>
        </div>
      </header>

      <div className="ai-presets">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            className="ai-preset"
            disabled={busy || !enabled}
            onClick={() => setInput(p.prompt)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="ai-list" ref={listRef}>
        {turns.length === 0 && (
          <div className="ai-empty">
            {enabled
              ? "提出一个问题，或点击预设并粘贴文本。"
              : "AI 尚未配置。请打开设置 → AI 助手。"}
          </div>
        )}
        {turns.map((t) => (
          <div key={t.id} className={`ai-turn ai-turn-${t.role}`}>
            <div className="ai-turn-role">
              {t.role === "user" ? "你" : "助手"}
            </div>
            <div className="ai-turn-content">
              {t.content || (t.streaming ? "…" : "")}
              {t.streaming && <span className="ai-cursor">▍</span>}
            </div>
            {t.error && <div className="ai-turn-error">{t.error}</div>}
          </div>
        ))}
        {error && turns.length === 0 && (
          <div className="ai-turn-error">{error}</div>
        )}
      </div>

      <div className="ai-composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          disabled={!enabled}
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="ai-composer-actions">
          {busy ? (
            <button className="ai-danger" onClick={cancel}>
              停止
            </button>
          ) : (
            <button
              className="ai-primary"
              onClick={submit}
              disabled={!enabled || input.trim().length === 0}
            >
              发送
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
