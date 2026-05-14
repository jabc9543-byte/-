// Web Clipper 原生扩展：与已有的 HTTP 接收端配合，提供应用内的快速剪藏、Obsidian Web Clipper 模板与日志管理。
// 已存在的能力：本地 HTTP 端口、token、receive_clip。本插件负责把这些能力以命令/斜杠形式暴露出来，并尽量与 Obsidian Web Clipper 行为对齐。

export const WEB_CLIPPER_MAIN_JS = String.raw`
function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(typeof ts === "number" ? ts * 1000 : ts);
  if (isNaN(d.getTime())) return String(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
    + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function nowIso() {
  return fmtTime(Date.now() / 1000);
}

async function doClip(payload) {
  return logseq.api.receiveClip(payload);
}

function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, ""); }

// Minimal HTML → Markdown conversion mirroring the subset Obsidian Web
// Clipper produces. Plain-text input is returned unchanged.
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
    await logseq.api.alert("\u5f53\u524d X-Clip-Token\uff1a\n\n" + t + "\n\n\u8bf7\u5728 Obsidian Web Clipper \u6269\u5c55 \u201c\u8bbe\u7f6e \u00b7 Custom Headers\u201d \u4e2d\u586b\u5165\u3002");
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
    "Web Clipper Pro \u4f7f\u7528\u6b65\u9aa4\uff08\u5b8c\u5168\u4ef9\u7167 Obsidian Web Clipper\uff09",
    "",
    "\u3010\u4e00\u3001\u5b89\u88c5\u6d4f\u89c8\u5668\u6269\u5c55\u3011",
    "\u00b7 Chrome / Edge\uff1a\u5b89\u88c5\u5b98\u65b9 Obsidian Web Clipper\u3002",
    "\u00b7 Firefox\uff1aAdd-ons \u5e02\u573a\u641c\u7d22 Obsidian Web Clipper \u5b89\u88c5\u3002",
    "",
    "\u3010\u4e8c\u3001\u8fde\u63a5\u672c\u5e94\u7528\u3011",
    "1. \u63d2\u4ef6\u9762\u677f \u00b7 Web Clipper \u9009\u9879\u5361\uff0c\u590d\u5236\u63a5\u6536 URL\uff1ahttp://127.0.0.1:33333/clip",
    "2. \u70b9 \u201c\u663e\u793a / \u590d\u5236\u201d \u53d6\u5f97 X-Clip-Token\u3002",
    "3. \u5728\u6d4f\u89c8\u5668\u6269\u5c55 \u201cSettings \u00b7 Advanced\u201d \u8bbe\u7f6e\uff1aMethod = POST\uff0cURL = \u4e0a\u8ff0 URL\uff0c\u589e\u52a0 Header\uff1aX-Clip-Token = \u4e0a\u8ff0 token\u3002",
    "",
    "\u3010\u4e09\u3001\u521b\u5efa\u6a21\u677f\u3011",
    "1. Obsidian Web Clipper \u8bbe\u7f6e \u00b7 Templates\uff0c\u65b0\u5efa\u4e00\u4e2a\u6a21\u677f\u3002",
    "2. Behavior \u9009 \u201cCustom URL\u201d\uff0c\u586b\u5165 quanshiwei://clip?title={{title}}&url={{url}}&body={{content}}&tags={{tags}}",
    "   \u6216 Behavior \u9009 \u201cWebhook\u201d\uff0c\u4f7f\u7528 HTTP \u7aef\u70b9\u3002",
    "3. Body \u9009\u9879\uff1aInclude frontmatter / Selection only / Convert images to base64\u3002",
    "4. \u53ef\u91cd\u590d\u521b\u5efa\u591a\u4e2a\u6a21\u677f\uff1a\u6587\u7ae0\u6574\u9875 / \u9009\u533a\u5f15\u7528 / \u9ad8\u4eae / \u4ee3\u7801\u7247\u6bb5\u3002",
    "",
    "\u3010\u56db\u3001\u5e94\u7528\u5185\u4f7f\u7528\u3011",
    "\u00b7 \u547d\u4ee4\uff1aClipper\uff1a\u5feb\u901f\u526a\u85cf\u5230\u4eca\u65e5\u3002",
    "\u00b7 \u547d\u4ee4\uff1aClipper\uff1a\u526a\u85cf\u9009\u533a / \u9ad8\u4eae\u3002",
    "\u00b7 \u547d\u4ee4\uff1aClipper\uff1a\u67e5\u770b token / \u63a5\u6536\u7aef\u70b9 / \u6700\u8fd1\u526a\u85cf\u8bb0\u5f55\u3002",
    "\u00b7 \u659c\u6760\uff1a/clip-here \u62fc\u63a5\u5757\uff1b/clip-log \u63d2\u5165\u8bb0\u5f55\uff1b/clip-template \u63d2\u5165 Obsidian \u6a21\u677f\u3002",
    "",
    "\u3010\u4e94\u3001\u6545\u969c\u6392\u67e5\u3011",
    "\u00b7 401 \u2192 token \u4e0d\u5339\u914d\uff0c\u9762\u677f \u201c\u91cd\u65b0\u751f\u6210\u201d \u540e\u540c\u6b65\u3002",
    "\u00b7 400 \u2192 \u8bf7\u6c42\u4f53\u4e0d\u662f JSON\uff0c\u68c0\u67e5 Content-Type\u3002",
    "\u00b7 \u672a\u8fd4\u56de page_name \u2192 \u662f journal \u6a21\u5f0f\uff0c\u5df2\u8ffd\u52a0\u5230\u4eca\u65e5\u3002",
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

logseq.slash.register("/clip-template", "Clipper\uff1a\u63d2\u5165 Obsidian \u6a21\u677f\u63cf\u8ff0", async ({ blockId }) => {
  const tpl = [
    "**Obsidian Web Clipper \u00b7 \u8bbe\u7f6e\u53c2\u8003**",
    "- URL\uff1aquanshiwei://clip?title={{title}}&url={{url}}&body={{content}}&tags={{tags}}",
    "- Method\uff1aPOST http://127.0.0.1:33333/clip",
    "- Headers\uff1aX-Clip-Token = \u4ece\u63d2\u4ef6 \u00b7 Web Clipper \u9762\u677f\u590d\u5236",
    "- Body \u9009\u9879\uff1aInclude frontmatter \u00b7 Selection only \u00b7 Convert images",
  ].join("\n");
  await logseq.api.updateBlock(blockId, tpl);
});
`;
