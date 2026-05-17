// Source for the bundled "Templates" native plugin (Obsidian core "Templates" 风格).
// 用法对齐图片：
//   1) 存放模板：在 "99-Templates" 页面下，每个一级块就是一个模板（块内 children 是模板正文）
//   2) 唤出命令：按 Ctrl+P 或 / 输入 Insert template
//   3) 搜索：在弹窗里挑选模板名称
//   4) 选择：模板内容插入当前块
//   5) 自动替换变量：{{date}} {{time}} {{title}}（不能有空格）

export const TEMPLATES_MAIN_JS = String.raw`
const TEMPLATES_PAGE = "99-Templates";

function pad(n) { return String(n).padStart(2, "0"); }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
function timeStr() {
  const d = new Date();
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function applyVariables(text, title) {
  return String(text || "")
    .replace(/\{\{date\}\}/g, todayStr())
    .replace(/\{\{time\}\}/g, timeStr())
    .replace(/\{\{title\}\}/g, title || "");
}

async function ensureTemplatesPage() {
  const pages = await logseq.api.listPages();
  return (pages || []).find((p) => p.name === TEMPLATES_PAGE) || null;
}

async function listTemplates() {
  const page = await ensureTemplatesPage();
  if (!page) return [];
  const blocks = await logseq.api.pageBlocks(page.id);
  // 顶层块的 content 第一行就是模板名
  const top = (blocks || []).filter((b) => !b.parent_id || b.parent_id === page.id || b.parent_id === null);
  return top.map((b) => {
    const lines = String(b.content || "").split(/\n/);
    const name = (lines[0] || "未命名").replace(/^#+\s*/, "").trim();
    return { id: b.id, name, content: b.content };
  });
}

async function buildTemplateText(tpl, page) {
  // 渲染：把该顶层块的内容 + 子块按层级拼接为多行 Markdown
  const blocks = await logseq.api.pageBlocks(page.id);
  const children = (blocks || []).filter((b) => b.parent_id === tpl.id);
  const head = String(tpl.content || "").split(/\n/).slice(1).join("\n").trim();
  const childTexts = children.map((c) => "- " + String(c.content || "").trim()).join("\n");
  let text = "";
  if (head) text += head + "\n";
  if (childTexts) text += childTexts + "\n";
  return text.trim();
}

logseq.commands.register("templates-manage", "Templates：管理模板（打开 99-Templates）", async () => {
  try {
    let page = await ensureTemplatesPage();
    if (!page) {
      logseq.api.notify("未找到 99-Templates 页面，请先手动新建一个同名页面");
      return;
    }
    await logseq.api.openPage(page.id);
    logseq.api.notify("已打开模板管理页。每个一级块就是一个模板，第一行=模板名");
  } catch (e) {
    logseq.api.notify("打开失败：" + (e && e.message ? e.message : e));
  }
});

async function pickAndInsert(blockId) {
  const tpls = await listTemplates();
  if (!tpls.length) {
    logseq.api.notify("99-Templates 中暂无模板。先到该页新建一级块，第一行写模板名");
    return;
  }
  const list = tpls.map((t, i) => (i + 1) + ". " + t.name).join("\n");
  const idxRaw = await logseq.api.prompt("Insert template — 输入编号：\n\n" + list + "\n\n编号：", "1");
  if (idxRaw === null) return;
  const idx = parseInt(String(idxRaw).trim(), 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= tpls.length) {
    logseq.api.notify("编号无效");
    return;
  }
  const tpl = tpls[idx];
  let title = "";
  if (/\{\{title\}\}/.test(tpl.content)) {
    const t = await logseq.api.prompt("{{title}} 的值（留空即不替换）：", "");
    if (t === null) return;
    title = String(t).trim();
  }
  const page = await ensureTemplatesPage();
  const raw = await buildTemplateText(tpl, page);
  const filled = applyVariables(raw, title);
  if (blockId) {
    await logseq.api.updateBlock(blockId, filled);
  } else {
    const j = await logseq.api.todayJournal();
    if (j) await logseq.api.insertBlock(j.id, null, null, filled);
  }
  logseq.api.notify("已插入模板：" + tpl.name);
}

logseq.commands.register("templates-insert", "Insert template", async () => {
  await pickAndInsert(null);
});

logseq.slash.register("/insert-template", "Insert template", async ({ blockId }) => {
  await pickAndInsert(blockId);
});
`;
