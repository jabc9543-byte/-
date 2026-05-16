const DEFAULTS = {
  endpoint: "http://127.0.0.1:33333/clip",
  token: "",
};

const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function setStatus(text, kind) {
  statusEl.textContent = text || "";
  statusEl.className = "status" + (kind ? " " + kind : "");
}

chrome.storage.sync.get(DEFAULTS, (cfg) => {
  $("endpoint").value = cfg.endpoint || DEFAULTS.endpoint;
  $("token").value = cfg.token || "";
});

$("save").addEventListener("click", () => {
  const endpoint = $("endpoint").value.trim() || DEFAULTS.endpoint;
  const token = $("token").value.trim();
  chrome.storage.sync.set({ endpoint, token }, () => {
    setStatus("已保存", "ok");
  });
});

function ask(type) {
  setStatus("处理中…");
  chrome.runtime.sendMessage({ type }, (resp) => {
    if (chrome.runtime.lastError) {
      setStatus("失败：" + chrome.runtime.lastError.message, "err");
      return;
    }
    if (!resp || !resp.ok) {
      setStatus("失败：" + ((resp && resp.error) || "未知错误"), "err");
      return;
    }
    if (type === "ping") {
      setStatus("连接正常（HTTP " + resp.status + "）", "ok");
    } else {
      setStatus("剪藏成功", "ok");
    }
  });
}

$("clip-page").addEventListener("click", () => ask("clip-page"));
$("clip-selection").addEventListener("click", () => ask("clip-selection"));
$("ping").addEventListener("click", () => ask("ping"));
