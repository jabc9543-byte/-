// Auto-registered "插入助手" plugin: slash-commands to insert formulas,
// links, images, code blocks, tables and horizontal rules into the current
// block. Designed to feel like Obsidian / Notion command palette.

export const INSERT_HELPERS_MAIN_JS = String.raw`
function safe(fn) {
  return async function () {
    try { return await fn.apply(null, arguments); }
    catch (e) { logseq.api.notify("插入助手出错：" + (e && e.message ? e.message : String(e))); }
  };
}

async function getBlock(ctx) {
  if (ctx && ctx.blockId) {
    const b = await logseq.api.getBlock(ctx.blockId);
    if (b) return b;
  }
  return null;
}

async function appendToToday(text) {
  const p = await logseq.api.todayJournal();
  if (!p || !p.id) { logseq.api.notify("无法获取今日 journal"); return; }
  await logseq.api.insertBlock(p.id, null, null, text);
  try { await logseq.api.openPage(p.id); } catch (_) {}
}

async function replaceOrAppend(ctx, content) {
  const b = await getBlock(ctx);
  if (b && b.id) {
    const prev = (b.content || "").trim();
    const next = prev ? (prev + "\\n" + content) : content;
    await logseq.api.updateBlock(b.id, next);
    return;
  }
  await appendToToday(content);
}

logseq.slash.register("/formula", "插入块级公式 $$ … $$", safe(async function (ctx) {
  const tex = await logseq.api.prompt("请输入 LaTeX 公式（不含 $$）：", "E = mc^2");
  if (tex === null) return;
  await replaceOrAppend(ctx, "$$" + tex + "$$");
  logseq.api.notify("已插入块级公式");
}));

logseq.slash.register("/inline-formula", "插入行内公式 $…$", safe(async function (ctx) {
  const tex = await logseq.api.prompt("请输入行内 LaTeX：", "\\\\sqrt{2}");
  if (tex === null) return;
  await replaceOrAppend(ctx, "$" + tex + "$");
  logseq.api.notify("已插入行内公式");
}));

logseq.slash.register("/link", "插入网页链接 [文字](URL)", safe(async function (ctx) {
  const url = await logseq.api.prompt("URL：", "https://");
  if (url === null) return;
  const text = await logseq.api.prompt("链接显示文字：", url);
  if (text === null) return;
  await replaceOrAppend(ctx, "[" + text + "](" + url + ")");
  logseq.api.notify("已插入链接");
}));

logseq.slash.register("/image-url", "插入图片 ![alt](URL)", safe(async function (ctx) {
  const url = await logseq.api.prompt("图片 URL：", "https://");
  if (url === null) return;
  const alt = await logseq.api.prompt("alt 文字（可空）：", "image");
  await replaceOrAppend(ctx, "![" + (alt || "") + "](" + url + ")");
  logseq.api.notify("已插入图片");
}));

logseq.slash.register("/code", "插入代码块", safe(async function (ctx) {
  const lang = await logseq.api.prompt("语言（如 ts/python/rust，可空）：", "ts");
  const code = await logseq.api.prompt("代码内容：", "console.log('hello');");
  if (code === null) return;
  const fence = "\\u0060\\u0060\\u0060";
  await replaceOrAppend(ctx, fence + (lang || "") + "\\n" + code + "\\n" + fence);
  logseq.api.notify("已插入代码块");
}));

logseq.slash.register("/table-2x2", "插入 2×2 表格", safe(async function (ctx) {
  const md = [
    "| 列 1 | 列 2 |",
    "| --- | --- |",
    "| a | b |",
    "| c | d |",
  ].join("\\n");
  await replaceOrAppend(ctx, md);
  logseq.api.notify("已插入 2×2 表格");
}));

logseq.slash.register("/hr", "插入分割线 ---", safe(async function (ctx) {
  await replaceOrAppend(ctx, "---");
  logseq.api.notify("已插入分割线");
}));

logseq.commands.register("insert-helpers-demo", "插入助手：演示（在今日 journal 写入示例）", safe(async function () {
  const p = await logseq.api.todayJournal();
  if (!p || !p.id) { logseq.api.notify("无法获取今日 journal"); return; }
  await logseq.api.insertBlock(p.id, null, null, "插入助手示例：行内公式 $E=mc^2$ 与链接 [全视维](https://example.com)");
  await logseq.api.insertBlock(p.id, null, null, "$$\\\\int_0^1 x^2 \\\\, dx = \\\\frac{1}{3}$$");
  try { await logseq.api.openPage(p.id); } catch (_) {}
  logseq.api.notify("已在今日 journal 写入示例公式与链接");
}));

logseq.commands.register("insert-helpers-help", "插入助手：查看使用说明", safe(async function () {
  await logseq.api.alert([
    "插入助手使用方法：",
    "1. 把光标放在想要的位置（任意块内）。",
    "2. 输入斜杠命令：",
    "   • /formula        块级公式 $$ … $$",
    "   • /inline-formula 行内公式 $…$",
    "   • /link           [文字](URL)",
    "   • /image-url      ![alt](URL)",
    "   • /code           代码块",
    "   • /table-2x2      2×2 表格",
    "   • /hr             分割线",
    "3. 按提示输入内容即可。",
    "",
    "若当前未聚焦任何块，则会写入今日 journal。",
  ].join("\\n"));
}));
`;
