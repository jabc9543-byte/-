// 全视维 Clipper — background service worker.
//
// Responsibilities:
//   * Register a context-menu item ("剪藏到全视维") on page + selection.
//   * On click: ask the active tab for its current selection (and title/URL),
//     then POST to http://127.0.0.1:33333/clip with the saved X-Clip-Token.
//   * Surface success/error as a desktop notification.
//
// All persistent state lives in chrome.storage.local. No remote calls
// other than the loopback POST.

const ENDPOINT = "http://127.0.0.1:33333/clip";
const HEALTH = "http://127.0.0.1:33333/health";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "qsw-clip-page",
    title: "剪藏整页到全视维",
    contexts: ["page"],
  });
  chrome.contextMenus.create({
    id: "qsw-clip-selection",
    title: "剪藏所选文字到全视维",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  const mode = info.menuItemId === "qsw-clip-selection" ? "selection" : "page";
  await clipFromTab(tab, mode);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "qsw-clip") {
    const tabId = msg.tabId ?? sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "no tab id" });
      return false;
    }
    chrome.tabs.get(tabId).then((tab) => clipFromTab(tab, msg.mode ?? "page"))
      .then((r) => sendResponse({ ok: true, result: r }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }
  if (msg?.type === "qsw-health") {
    healthCheck().then((r) => sendResponse(r));
    return true;
  }
  return false;
});

async function getToken() {
  const { token } = await chrome.storage.local.get("token");
  return token ?? "";
}

async function healthCheck() {
  try {
    const res = await fetch(HEALTH, { method: "GET" });
    if (!res.ok) return { ok: false, status: res.status };
    const json = await res.json().catch(() => null);
    return { ok: true, status: res.status, body: json };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function clipFromTab(tab, mode) {
  const token = await getToken();
  if (!token) {
    notify("缺少访问令牌", "请打开扩展选项页粘贴桌面端 Clipper 令牌后再试。");
    return { error: "missing token" };
  }

  // Pull title/url/selection out of the tab via injected script.
  let injected;
  try {
    const [out] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        title: document.title || "",
        url: location.href,
        selection: window.getSelection?.()?.toString() ?? "",
        bodyText: document.body?.innerText?.slice(0, 200000) ?? "",
      }),
    });
    injected = out?.result;
  } catch (e) {
    notify("无法读取页面内容", String(e));
    return { error: String(e) };
  }
  if (!injected) {
    notify("剪藏失败", "脚本注入返回空结果");
    return { error: "no result" };
  }

  const body = mode === "selection" && injected.selection
    ? injected.selection
    : (injected.selection || injected.bodyText);

  const payload = {
    title: injected.title,
    url: injected.url,
    body,
    tags: [mode === "selection" ? "selection" : "clipped"],
    mode: mode === "selection" ? "journal" : "page",
  };

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clip-token": token,
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      notify(`剪藏失败 (${res.status})`, text.slice(0, 200));
      return { ok: false, status: res.status, body: text };
    }
    notify("剪藏成功", payload.title || "(无标题)");
    return { ok: true, status: res.status, body: text };
  } catch (e) {
    notify("无法连接桌面端", "请确认全视维已启动并监听 127.0.0.1:33333。");
    return { error: String(e) };
  }
}

function notify(title, message) {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title: String(title),
      message: String(message ?? ""),
    });
  } catch {
    /* ignore */
  }
}
