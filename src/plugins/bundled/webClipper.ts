// Web Clipper 原生扩展：与已有的 HTTP 接收端配合，提供应用内的快速剪藏、token 查看与日志查看能力。
// 已存在的能力：本地 HTTP 端口、token、receive_clip。本插件负责把这些能力以命令/斜杠形式暴露出来。
// - 命令"Clipper：快速剪藏当前 URL"  → 输入 URL/标题/正文，调用 receiveClip
// - 命令"Clipper：复制 X-Clip-Token" → 弹窗显示 token 让用户复制
// - 命令"Clipper：查看最近剪藏日志"  → 弹窗显示最近请求
// - /clip-here → 输入 URL+标题后，把 markdown 抓回写入今日 journal
// - /clip-log  → 把最近剪藏日志以列表形式插入当前块

export const WEB_CLIPPER_MAIN_JS = String.raw`
function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(typeof ts === "number" ? ts * 1000 : ts);
  if (isNaN(d.getTime())) return String(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
    + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

async function doClip(payload) {
  return logseq.api.receiveClip(payload);
}

logseq.commands.register("clipper-token", "Clipper\uff1a\u67e5\u770b X-Clip-Token", async () => {
  try {
    const t = await logseq.api.clipperToken();
    if (!t) {
      logseq.api.notify("\u672a\u83b7\u53d6\u5230 token");
      return;
    }
    await logseq.api.prompt("\u5f53\u524d X-Clip-Token\uff08\u9700\u8981\u5728\u6d4f\u89c8\u5668\u6269\u5c55\u4e2d\u586b\u5165\uff09\uff1a", t);
  } catch (e) {
    logseq.api.notify("\u83b7\u53d6 token \u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.commands.register("clipper-log", "Clipper\uff1a\u67e5\u770b\u6700\u8fd1\u526a\u85cf\u8bb0\u5f55", async () => {
  try {
    const logs = await logseq.api.clipperLog();
    if (!logs || logs.length === 0) {
      logseq.api.notify("\u8fd8\u6ca1\u6709\u526a\u85cf\u8bb0\u5f55");
      return;
    }
    const lines = logs
      .slice(-15)
      .reverse()
      .map((e) => fmtTime(e.ts) + "  " + e.status + "  " + (e.title || "(\u65e0\u6807\u9898)"));
    await logseq.api.alert("\u6700\u8fd1\u526a\u85cf\u8bb0\u5f55\uff1a\n\n" + lines.join("\n"));
  } catch (e) {
    logseq.api.notify("\u8bfb\u53d6\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.commands.register("clipper-quick", "Clipper\uff1a\u5feb\u901f\u526a\u85cf\u5230\u4eca\u65e5", async () => {
  try {
    const title = await logseq.api.prompt("\u6587\u7ae0\u6807\u9898\uff08\u53ef\u7559\u7a7a\u4e3a journal \u6a21\u5f0f\uff09\uff1a", "");
    if (title === null) return;
    const url = await logseq.api.prompt("\u6765\u6e90 URL\uff1a", "");
    if (url === null) return;
    const body = await logseq.api.prompt("\u6b63\u6587 Markdown\uff1a", "");
    if (body === null) return;
    const tagsRaw = await logseq.api.prompt("\u6807\u7b7e\uff08\u9017\u53f7\u5206\u9694\uff0c\u53ef\u7559\u7a7a\uff09\uff1a", "");
    const tags = (tagsRaw || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const mode = title.trim() ? "page" : "journal";
    const r = await doClip({ title: title.trim(), url: url.trim(), body, tags, mode });
    logseq.api.notify("\u526a\u85cf\u5b8c\u6210\uff1a" + (r && r.page_name ? r.page_name : "OK"));
  } catch (e) {
    logseq.api.notify("\u526a\u85cf\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.slash.register("/clip-here", "Clipper\uff1a\u62fc\u63a5\u5757\u4e3a\u4e00\u6761\u526a\u85cf", async ({ blockId }) => {
  try {
    const title = await logseq.api.prompt("\u6807\u9898\uff1a", "");
    if (title === null) return;
    const url = await logseq.api.prompt("URL\uff1a", "");
    if (url === null) return;
    const body = await logseq.api.prompt("\u6b63\u6587 Markdown\uff1a", "");
    if (body === null) return;
    const r = await doClip({ title: title.trim(), url: url.trim(), body, tags: [], mode: title.trim() ? "page" : "journal" });
    const link = "\ud83d\udcce \u526a\u85cf\uff1a" + (r && r.page_name ? "[[" + r.page_name + "]]" : title || url);
    await logseq.api.updateBlock(blockId, link);
  } catch (e) {
    logseq.api.notify("\u526a\u85cf\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.slash.register("/clip-log", "Clipper\uff1a\u63d2\u5165\u6700\u8fd1\u526a\u85cf\u8bb0\u5f55", async ({ blockId }) => {
  try {
    const logs = await logseq.api.clipperLog();
    if (!logs || logs.length === 0) {
      await logseq.api.updateBlock(blockId, "- *\u8fd8\u6ca1\u6709\u526a\u85cf\u8bb0\u5f55*");
      return;
    }
    const lines = logs
      .slice(-30)
      .reverse()
      .map((e) => "- " + fmtTime(e.ts) + " \u00b7 " + e.status + " \u00b7 " + (e.title || "(\u65e0\u6807\u9898)"));
    await logseq.api.updateBlock(blockId, "**\u6700\u8fd1\u526a\u85cf (" + lines.length + ")**\n" + lines.join("\n"));
  } catch (e) {
    logseq.api.notify("\u8bfb\u53d6\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});
`;
