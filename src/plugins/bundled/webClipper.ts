// 全视维 Web Clipper Pro —— 自研剪藏管线，不依赖 Obsidian Web Clipper。
// 与本地 HTTP 接收端 + 配套浏览器扩展 (quanshiwei-web-clipper) 配合：
//
//   浏览器扩展（content + popup）→ POST http://127.0.0.1:33333/clip
//                                  └─ Header: X-Clip-Token: <token>
//                                  └─ Body  : { title, url, body, tags, mode }
//
// 浏览器扩展源码 + 可下载的 zip 见仓库 dist/quanshiwei-web-clipper.zip
// 与 docs/web-clipper-extension/。

export const WEB_CLIPPER_MAIN_JS = String.raw`
function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(typeof ts === "number" ? ts * 1000 : ts);
  if (isNaN(d.getTime())) return String(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
    + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function nowIso() { return fmtTime(Date.now() / 1000); }

async function doClip(payload) { return logseq.api.receiveClip(payload); }

function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, ""); }

// 极简 HTML → Markdown：覆盖剪藏常见标签。
function htmlToMd(input) {
  if (!input) return "";
  if (!/<\w+/.test(input)) return input;
  let s = String(input)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n, t) => "\n" + "#".repeat(+n) + " " + stripTags(t).trim() + "\n");
  s = s.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
       .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**")
       .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*")
       .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*")
       .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "\`$1\`")
       .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
       .replace(/<img [^>]*src="([^"]*)"[^>]*\/?>/gi, "![]($1)")
       .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
       .replace(/<\/p>/gi, "\n\n")
       .replace(/<br\s*\/?>/gi, "\n");
  s = stripTags(s);
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
       .replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

function buildFrontmatter(title, url, tags) {
  const tagLines = tags && tags.length ? tags.map((t) => "  - " + t).join("\n") : "";
  const parts = ["---", "title: " + JSON.stringify(title || "")];
  if (url) parts.push("source: " + url);
  parts.push("clipped: " + nowIso());
  if (tags && tags.length) { parts.push("tags:"); parts.push(tagLines); }
  parts.push("---", "");
  return parts.join("\n");
}

async function promptClip(defaults) {
  defaults = defaults || {};
  const title = await logseq.api.prompt("\u6587\u7ae0\u6807\u9898\uff08\u7559\u7a7a\u5219\u8ffd\u52a0\u5230\u4eca\u65e5 journal\uff09\uff1a", defaults.title || "");
  if (title === null) return null;
  const url = await logseq.api.prompt("\u6765\u6e90 URL\uff1a", defaults.url || "");
  if (url === null) return null;
  const body = await logseq.api.prompt("\u6b63\u6587\uff08\u5141\u8bb8 Markdown \u6216 HTML\uff09\uff1a", defaults.body || "");
  if (body === null) return null;
  const tagsRaw = await logseq.api.prompt("\u6807\u7b7e\uff08\u9017\u53f7\u5206\u9694\uff0c\u53ef\u7559\u7a7a\uff09\uff1a", (defaults.tags || []).join(","));
  if (tagsRaw === null) return null;
  const tags = String(tagsRaw).split(",").map((s) => s.trim()).filter(Boolean);
  return { title: title.trim(), url: url.trim(), body, tags };
}

logseq.commands.register("clipper-token", "Clipper\uff1a\u67e5\u770b X-Clip-Token", async () => {
  try {
    const t = await logseq.api.clipperToken();
    if (!t) { logseq.api.notify("\u672a\u83b7\u53d6\u5230 token"); return; }
    await logseq.api.alert("\u5f53\u524d X-Clip-Token\uff1a\n\n" + t + "\n\n\u8bf7\u5728\u300a\u5168\u89c6\u7ef4 Web Clipper\u300b\u6d4f\u89c8\u5668\u6269\u5c55\u4e2d\u7c98\u8d34\u5230 token \u8f93\u5165\u6846\u3002");
  } catch (e) {
    logseq.api.notify("\u83b7\u53d6 token \u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.commands.register("clipper-endpoint", "Clipper\uff1a\u67e5\u770b\u672c\u5730\u63a5\u6536\u7aef\u70b9", async () => {
  await logseq.api.alert("\u672c\u5730\u63a5\u6536\u7aef\u70b9\uff1a\n\nhttp://127.0.0.1:33333/clip\n\n\u4ec5\u7ed1\u5b9a 127.0.0.1\uff0c\u5c40\u57df\u7f51\u5176\u4ed6\u8bbe\u5907\u65e0\u6cd5\u8bbf\u95ee\u3002\n\u5065\u5eb7\u68c0\u67e5\uff1aGET http://127.0.0.1:33333/health \u8fd4\u56de {\"ok\":true}.");
});

logseq.commands.register("clipper-log", "Clipper\uff1a\u67e5\u770b\u6700\u8fd1\u526a\u85cf\u8bb0\u5f55", async () => {
  try {
    const logs = await logseq.api.clipperLog();
    if (!logs || logs.length === 0) { logseq.api.notify("\u8fd8\u6ca1\u6709\u526a\u85cf\u8bb0\u5f55"); return; }
    const lines = logs.slice(-15).reverse()
      .map((e) => fmtTime(e.ts) + "  " + e.status + "  " + (e.title || "(\u65e0\u6807\u9898)"));
    await logseq.api.alert("\u6700\u8fd1\u526a\u85cf\u8bb0\u5f55\uff1a\n\n" + lines.join("\n"));
  } catch (e) {
    logseq.api.notify("\u8bfb\u53d6\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.commands.register("clipper-quick", "Clipper\uff1a\u5feb\u901f\u526a\u85cf\u5230\u4eca\u65e5", async () => {
  try {
    const p = await promptClip();
    if (!p) return;
    const md = buildFrontmatter(p.title, p.url, p.tags) + htmlToMd(p.body);
    const mode = p.title ? "page" : "journal";
    const r = await doClip({ title: p.title, url: p.url, body: md, tags: p.tags, mode });
    logseq.api.notify("\u526a\u85cf\u5b8c\u6210\uff1a" + (r && r.page_name ? r.page_name : "OK"));
  } catch (e) {
    logseq.api.notify("\u526a\u85cf\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.commands.register("clipper-highlight", "Clipper\uff1a\u526a\u85cf\u9009\u533a / \u9ad8\u4eae", async () => {
  try {
    const url = await logseq.api.prompt("\u6765\u6e90 URL\uff1a", "");
    if (url === null) return;
    const body = await logseq.api.prompt("\u9ad8\u4eae / \u5f15\u7528\u6587\u672c\uff1a", "");
    if (body === null) return;
    const note = await logseq.api.prompt("\u8865\u5145\u6279\u6ce8\uff08\u53ef\u7559\u7a7a\uff09\uff1a", "");
    const tagsRaw = await logseq.api.prompt("\u6807\u7b7e\uff08\u9017\u53f7\u5206\u9694\uff09\uff1a", "highlight");
    const tags = String(tagsRaw || "").split(",").map((s) => s.trim()).filter(Boolean);
    const quoted = String(body).split(/\n/).map((l) => "> " + l).join("\n");
    const md = quoted + (note ? "\n\n\u6279\u6ce8\uff1a" + note : "") + (url ? "\n\n\u6765\u6e90\uff1a<" + url + ">" : "");
    await doClip({ title: "", url: url.trim(), body: md, tags, mode: "journal" });
    logseq.api.notify("\u9ad8\u4eae\u5df2\u8ffd\u52a0\u5230\u4eca\u65e5 journal");
  } catch (e) {
    logseq.api.notify("\u9ad8\u4eae\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.commands.register("clipper-help", "Clipper\uff1a\u8be6\u7ec6\u4f7f\u7528\u6b65\u9aa4", async () => {
  const lines = [
    "\u3010\u5168\u89c6\u7ef4 Web Clipper Pro \u4f7f\u7528\u6b65\u9aa4\u3011",
    "",
    "\u4e00\u3001\u4e0b\u8f7d\u6d4f\u89c8\u5668\u6269\u5c55",
    "1. \u6253\u5f00 GitHub Releases\uff0c\u4e0b\u8f7d quanshiwei-web-clipper-vX.zip \u5e76\u89e3\u538b\u3002",
    "2. \u6d4f\u89c8\u5668\u8fdb\u5165\u300a\u6269\u5c55\u7a0b\u5e8f \u00b7 \u5f00\u53d1\u8005\u6a21\u5f0f\u300b\uff0c\u70b9 \u201c\u52a0\u8f7d\u5df2\u89e3\u538b\u7684\u6269\u5c55\u201d\uff0c\u9009\u4e2d\u521a\u624d\u89e3\u538b\u51fa\u7684\u6587\u4ef6\u5939\u3002",
    "",
    "\u4e8c\u3001\u8fde\u63a5\u672c\u5e94\u7528",
    "1. \u5728\u300a\u63d2\u4ef6 \u00b7 Clipper\u300b\u9762\u677f\u70b9 \u201c\u663e\u793a / \u590d\u5236\u201d \u53d6\u5f97 X-Clip-Token\u3002",
    "2. \u70b9\u6d4f\u89c8\u5668\u53f3\u4e0a\u89d2\u300a\u5168\u89c6\u7ef4 Clipper\u300b\u56fe\u6807\u2192 Settings\uff0c\u7c98\u8d34 token \u5e76\u70b9\u300c\u4fdd\u5b58\u300d\u3002",
    "",
    "\u4e09\u3001\u4f7f\u7528\u65b9\u5f0f",
    "\u00b7 \u70b9\u6269\u5c55\u56fe\u6807 \u2192 \u300c\u526a\u85cf\u6574\u9875\u300d\uff1a\u4ee5 Readability \u63d0\u53d6\u6b63\u6587 + \u6807\u9898\uff0c\u5199\u5165\u540c\u540d\u9875\u9762\u3002",
    "\u00b7 \u9875\u9762\u5185\u9009\u4e2d\u6587\u672c\u540e\u70b9 \u300c\u526a\u85cf\u9009\u533a\u300d\uff1a\u53ea\u5199\u9009\u4e2d\u90e8\u5206\u5230\u4eca\u65e5 journal\u3002",
    "\u00b7 \u53f3\u952e\u83dc\u5355\u300c\u526a\u85cf\u8fd9\u4e2a\u94fe\u63a5\u300d\uff1a\u5feb\u901f\u4fdd\u5b58 URL + \u6807\u9898\u5230\u4eca\u65e5\u3002",
    "",
    "\u56db\u3001\u5e94\u7528\u5185\u624b\u52a8\u526a\u85cf",
    "\u00b7 \u547d\u4ee4\uff1aClipper\uff1a\u5feb\u901f\u526a\u85cf\u5230\u4eca\u65e5 / \u526a\u85cf\u9009\u533a / \u67e5\u770b\u8bb0\u5f55\u3002",
    "\u00b7 \u659c\u6760\uff1a/clip-here \u62fc\u63a5\u5757\u4e3a\u4e00\u6761\u526a\u85cf\u3002",
    "\u00b7 \u659c\u6760\uff1a/clip-log \u63d2\u5165\u6700\u8fd1\u526a\u85cf\u8bb0\u5f55\u3002",
    "",
    "\u4e94\u3001\u6545\u969c\u6392\u67e5",
    "\u00b7 HTTP 401 \u2192 token \u4e0d\u5339\u914d\uff0c\u91cd\u65b0\u590d\u5236\u540e\u586b\u5165\u6269\u5c55\u3002",
    "\u00b7 HTTP 400 \u2192 \u8bf7\u6c42\u4f53\u4e0d\u662f JSON\uff0c\u68c0\u67e5\u6269\u5c55\u662f\u5426\u6700\u65b0\u3002",
    "\u00b7 \u8fde\u4e0d\u4e0a 33333 \u2192 \u786e\u8ba4\u5e94\u7528\u8fd0\u884c\u4e2d\uff1bWindows \u4e0a\u9632\u706b\u5899\u9009\u300c\u4ec5\u4e2a\u4eba/\u79c1\u6709\u7f51\u7edc\u300d\u653e\u884c\u3002",
  ].join("\n");
  await logseq.api.alert(lines);
});

logseq.slash.register("/clip-here", "Clipper\uff1a\u62fc\u63a5\u5757\u4e3a\u4e00\u6761\u526a\u85cf", async ({ blockId }) => {
  try {
    const p = await promptClip();
    if (!p) return;
    const md = buildFrontmatter(p.title, p.url, p.tags) + htmlToMd(p.body);
    const r = await doClip({ title: p.title, url: p.url, body: md, tags: p.tags, mode: p.title ? "page" : "journal" });
    const link = "\ud83d\udcce \u526a\u85cf\uff1a" + (r && r.page_name ? "[[" + r.page_name + "]]" : p.title || p.url);
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
    const lines = logs.slice(-30).reverse()
      .map((e) => "- " + fmtTime(e.ts) + " \u00b7 " + e.status + " \u00b7 " + (e.title || "(\u65e0\u6807\u9898)"));
    await logseq.api.updateBlock(blockId, "**\u6700\u8fd1\u526a\u85cf (" + lines.length + ")**\n" + lines.join("\n"));
  } catch (e) {
    logseq.api.notify("\u8bfb\u53d6\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});
`;
