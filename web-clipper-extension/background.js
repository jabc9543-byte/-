// 全视维 Web Clipper · Service Worker
const DEFAULTS = {
  endpoint: "http://127.0.0.1:33333/clip",
  token: "",
};

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, (cfg) => resolve(cfg || DEFAULTS));
  });
}

async function clip(payload) {
  const cfg = await getConfig();
  if (!cfg.token) {
    throw new Error("尚未设置 token，请打开扩展弹窗 → Settings 粘贴 token。");
  }
  const resp = await fetch(cfg.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-clip-token": cfg.token,
    },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error("HTTP " + resp.status + ": " + text.slice(0, 200));
  }
  try { return JSON.parse(text); } catch { return { ok: true }; }
}

function notify(title, message) {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: title,
      message: String(message).slice(0, 200),
    });
  } catch {}
}

async function runInTab(tabId, type) {
  // 确保 content.js 已注入
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch (e) {
    throw new Error("无法注入页面脚本：" + (e && e.message ? e.message : e));
  }
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type }, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!resp || !resp.ok) {
        reject(new Error((resp && resp.error) || "页面脚本未返回数据"));
        return;
      }
      resolve(resp.payload);
    });
  });
}

async function clipPage(tab) {
  const payload = await runInTab(tab.id, "extract-page");
  const r = await clip(payload);
  notify("剪藏完成", r.page_name || payload.title || tab.url);
}

async function clipSelection(tab) {
  const payload = await runInTab(tab.id, "extract-selection");
  if (!payload.body) throw new Error("当前页面没有选中文本");
  const r = await clip(payload);
  notify("剪藏完成", r.page_name || payload.title || tab.url);
}

async function clipLink(linkUrl, tab) {
  const payload = {
    title: tab && tab.title ? tab.title : linkUrl,
    url: linkUrl,
    body: "来源：<" + linkUrl + ">",
    tags: ["link"],
    mode: "journal",
  };
  await clip(payload);
  notify("链接已剪藏", linkUrl);
}

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.create({
      id: "qsw-clip-page",
      title: "剪藏整页到全视维",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: "qsw-clip-selection",
      title: "剪藏选区到全视维",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "qsw-clip-link",
      title: "剪藏此链接到全视维",
      contexts: ["link"],
    });
  } catch {}
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === "qsw-clip-page") await clipPage(tab);
    else if (info.menuItemId === "qsw-clip-selection") await clipSelection(tab);
    else if (info.menuItemId === "qsw-clip-link") await clipLink(info.linkUrl, tab);
  } catch (e) {
    notify("剪藏失败", e && e.message ? e.message : String(e));
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (msg.type === "clip-page") { await clipPage(tab); sendResponse({ ok: true }); }
      else if (msg.type === "clip-selection") { await clipSelection(tab); sendResponse({ ok: true }); }
      else if (msg.type === "ping") {
        const cfg = await getConfig();
        const resp = await fetch(cfg.endpoint.replace(/\/clip\/?$/, "/health"));
        sendResponse({ ok: resp.ok, status: resp.status });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  })();
  return true;
});
