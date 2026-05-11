const $ = (id) => document.getElementById(id);

function setStatus(text, kind) {
  const el = $("status");
  el.textContent = text;
  el.className = kind ?? "";
}

async function init() {
  const { token } = await chrome.storage.local.get("token");
  if (token) $("token").value = token;
}

$("save").addEventListener("click", async () => {
  const v = $("token").value.trim();
  await chrome.storage.local.set({ token: v });
  setStatus(v ? "已保存令牌。" : "已清空令牌。", "ok");
});

const healthBtn = $("health") ?? $("test");
healthBtn?.addEventListener("click", async () => {
  setStatus("正在测试…");
  const r = await chrome.runtime.sendMessage({ type: "qsw-health" });
  if (r?.ok) setStatus(`连接成功 (HTTP ${r.status})`, "ok");
  else setStatus(`连接失败：${r?.error ?? r?.status ?? "未知错误"}`, "err");
});

async function clip(mode) {
  setStatus("剪藏中…");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus("找不到活动标签页", "err");
    return;
  }
  const r = await chrome.runtime.sendMessage({ type: "qsw-clip", tabId: tab.id, mode });
  if (r?.ok && r.result?.ok) setStatus("剪藏成功。", "ok");
  else if (r?.result?.error) setStatus(`失败：${r.result.error}`, "err");
  else if (r?.result?.status) setStatus(`失败：HTTP ${r.result.status}`, "err");
  else setStatus("失败：未知错误", "err");
}

$("clip")?.addEventListener("click", () => clip("page"));
$("clip-sel")?.addEventListener("click", () => clip("selection"));

init();
