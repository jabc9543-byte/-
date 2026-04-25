import { useEffect, useState } from "react";
import { useAiStore } from "../stores/ai";
import type { AiConfigView } from "../types";

type DraftPatch = Partial<AiConfigView> & { api_key?: string };

export function AiSection() {
  const config = useAiStore((s) => s.config);
  const configLoading = useAiStore((s) => s.configLoading);
  const refreshConfig = useAiStore((s) => s.refreshConfig);
  const saveConfig = useAiStore((s) => s.saveConfig);
  const error = useAiStore((s) => s.error);

  const [draft, setDraft] = useState<DraftPatch>({});
  const [apiKeyInput, setApiKeyInput] = useState("");

  useEffect(() => {
    refreshConfig().catch(() => {});
  }, [refreshConfig]);

  if (!config) {
    return (
      <section className="settings-section">
        <h3>AI 助手</h3>
        <p className="settings-hint">
          {configLoading ? "加载中…" : "请先打开一个图谱再配置 AI。"}
        </p>
      </section>
    );
  }

  const merged: AiConfigView = { ...config, ...draft };

  const commit = async (patch: DraftPatch) => {
    try {
      await saveConfig(patch);
      setDraft({});
    } catch {
      /* surfaced via store */
    }
  };

  return (
    <section className="settings-section">
      <h3>AI 助手</h3>
      <p className="settings-hint">
        连接任何兼容 OpenAI 的 chat completions 接口。API 密钥将保存在图谱目录内——请勿与不可信工具共享图谱文件夹。
      </p>

      <label className="settings-row">
        <input
          type="checkbox"
          checked={merged.enabled}
          onChange={(e) => commit({ enabled: e.target.checked })}
        />
        <span>启用 AI 助手</span>
      </label>

      <label className="settings-row settings-row-col">
        <span>接口地址</span>
        <input
          type="text"
          value={merged.endpoint}
          onChange={(e) =>
            setDraft((d) => ({ ...d, endpoint: e.target.value }))
          }
          onBlur={() =>
            draft.endpoint !== undefined &&
            commit({ endpoint: draft.endpoint })
          }
          placeholder="https://api.openai.com/v1/chat/completions"
        />
      </label>

      <label className="settings-row settings-row-col">
        <span>模型</span>
        <input
          type="text"
          value={merged.model}
          onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
          onBlur={() =>
            draft.model !== undefined && commit({ model: draft.model })
          }
          placeholder="gpt-4o-mini"
        />
      </label>

      <label className="settings-row settings-row-col">
        <span>
          API 密钥
          {config.has_api_key && (
            <span className="settings-hint"> （已保存）</span>
          )}
        </span>
        <div className="ai-key-row">
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder={config.has_api_key ? "••••••••（已保存）" : "sk-…"}
          />
          <button
            type="button"
            className="settings-reconnect"
            disabled={apiKeyInput.length === 0}
            onClick={async () => {
              await commit({ api_key: apiKeyInput });
              setApiKeyInput("");
            }}
          >
            保存密钥
          </button>
          {config.has_api_key && (
            <button
              type="button"
              className="backup-danger"
              onClick={() => commit({ api_key: "" })}
            >
              清除
            </button>
          )}
        </div>
      </label>

      <label className="settings-row settings-row-col">
        <span>温度（{merged.temperature.toFixed(2)}）</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={merged.temperature}
          onChange={(e) =>
            setDraft((d) => ({ ...d, temperature: Number(e.target.value) }))
          }
          onMouseUp={() =>
            draft.temperature !== undefined &&
            commit({ temperature: draft.temperature })
          }
          onTouchEnd={() =>
            draft.temperature !== undefined &&
            commit({ temperature: draft.temperature })
          }
        />
      </label>

      <label className="settings-row settings-row-col">
        <span>最大 token 数</span>
        <input
          type="number"
          min={16}
          max={32768}
          value={merged.max_tokens}
          onChange={(e) =>
            setDraft((d) => ({ ...d, max_tokens: Number(e.target.value) }))
          }
          onBlur={() =>
            draft.max_tokens !== undefined &&
            commit({ max_tokens: draft.max_tokens })
          }
        />
      </label>

      <label className="settings-row settings-row-col">
        <span>系统提示词</span>
        <textarea
          value={merged.system_prompt}
          rows={4}
          onChange={(e) =>
            setDraft((d) => ({ ...d, system_prompt: e.target.value }))
          }
          onBlur={() =>
            draft.system_prompt !== undefined &&
            commit({ system_prompt: draft.system_prompt })
          }
        />
      </label>

      {error && <div className="backup-error">{error}</div>}
    </section>
  );
}
