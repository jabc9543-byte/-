import { useEffect, useRef, useState } from "react";
import { usePluginStore } from "../stores/plugins";

export function PluginPrompt() {
  const promptRequest = usePluginStore((s) => s.promptRequest);
  const alertRequest = usePluginStore((s) => s.alertRequest);
  const resolvePrompt = usePluginStore((s) => s.resolvePrompt);
  const resolveAlert = usePluginStore((s) => s.resolveAlert);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (promptRequest) {
      setValue(promptRequest.default ?? "");
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
    }
  }, [promptRequest?.id]);

  if (!promptRequest && !alertRequest) return null;

  const onOk = () => {
    if (promptRequest) resolvePrompt(promptRequest.id, value);
    else if (alertRequest) resolveAlert(alertRequest.id);
  };
  const onCancel = () => {
    if (promptRequest) resolvePrompt(promptRequest.id, null);
    else if (alertRequest) resolveAlert(alertRequest.id);
  };

  return (
    <div className="plugin-prompt-overlay" onClick={onCancel}>
      <div className="plugin-prompt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="plugin-prompt-title">
          {promptRequest ? "插件请求输入" : "插件提示"}
        </div>
        <div className="plugin-prompt-message">
          {(promptRequest?.message ?? alertRequest?.message ?? "")
            .split("\n")
            .map((line, i) => (
              <div key={i}>{line}</div>
            ))}
        </div>
        {promptRequest && (
          <textarea
            ref={inputRef}
            className="plugin-prompt-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onOk();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
              }
            }}
            rows={3}
            autoFocus
          />
        )}
        <div className="plugin-prompt-actions">
          {promptRequest && (
            <button className="plugin-prompt-btn" onClick={onCancel}>
              取消
            </button>
          )}
          <button className="plugin-prompt-btn primary" onClick={onOk}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
