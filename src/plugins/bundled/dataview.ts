// 仿照 Obsidian Dataview 的核心查询/聚合渲染能力，使用原生 RPC 实现：
// - /dv-tasks         插入「全部未完成任务」清单
// - /dv-today         插入「今日 journal 块」清单
// - /dv-backlinks     插入「指向当前页的反链」清单
// - /dv-tag #foo      插入「含某个标签的块」清单（可在 prompt 中输入）
// - /dv-recent        插入「最近更新页面」清单
// 所有结果都会替换当前块为一个 Markdown 列表（含状态、来源页）。

export const DATAVIEW_MAIN_JS = String.raw`
function ymdToday() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function truncate(s, n) {
  s = String(s ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "\u2026" : s;
}

function fmtTask(b) {
  const tm = b.task_marker ? "[" + b.task_marker + "] " : "";
  const ref = b.page_id ? " \u00b7 [[" + b.page_id + "]]" : "";
  return "- " + tm + truncate(b.content, 120) + ref;
}

function fmtBlock(b) {
  const ref = b.page_id ? " \u00b7 [[" + b.page_id + "]]" : "";
  return "- " + truncate(b.content, 140) + ref;
}

function fmtPage(p) {
  const day = p.journal_day ? " (journal " + p.journal_day + ")" : "";
  return "- [[" + p.name + "]]" + day;
}

async function replaceBlock(blockId, lines, header) {
  const body = (header ? "**" + header + "**\n" : "") + lines.join("\n");
  await logseq.api.updateBlock(blockId, body);
}

logseq.slash.register("/dv-tasks", "Dataview\uff1a\u63d2\u5165\u6240\u6709\u672a\u5b8c\u6210\u4efb\u52a1", async ({ blockId }) => {
  try {
    const tasks = await logseq.api.openTasks();
    if (!tasks || tasks.length === 0) {
      // Helpful fallback: tell the user that no TODO marker was found and
      // explain how to create one. Most users type "未完成任务 xxxx" as
      // plain text expecting it to be a task; this clears that up.
      const hint = [
        "- *\u672a\u68c0\u6d4b\u5230\u4efb\u52a1\u5757\u3002*",
        "- \u8f93\u5165 /todo \u53ef\u4ee5\u5feb\u901f\u521b\u5efa\u4e00\u4e2a TODO \u4efb\u52a1\u5757\u3002",
        "- \u6216\u8005\u624b\u52a8\u5728\u5757\u9996\u52a0 \`TODO\u3001DOING\u3001LATER\u3001NOW\u3001WAITING\` \u4e4b\u4e00\u3002",
        "- \u4efb\u52a1\u5757\u4f1a\u81ea\u52a8\u51fa\u73b0\u5728\u5de6\u4fa7\u201c\u65e5\u7a0b\u201d\u4e2d\u3002"
      ];
      await replaceBlock(blockId, hint, "\u672a\u5b8c\u6210\u4efb\u52a1 (0)");
      logseq.api.notify("\u6ca1\u6709\u4efb\u52a1\u5757\u3002\u8f93\u5165 /todo \u521b\u5efa\u4e00\u4e2a\u3002");
      return;
    }
    const lines = tasks.slice(0, 200).map(fmtTask);
    await replaceBlock(blockId, lines, "\u672a\u5b8c\u6210\u4efb\u52a1 (" + tasks.length + ")");
    logseq.api.notify("Dataview\uff1a\u5df2\u63d2\u5165 " + tasks.length + " \u6761\u4efb\u52a1");
  } catch (e) {
    logseq.api.notify("\u67e5\u8be2\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.slash.register("/todo", "Dataview\uff1a\u628a\u5f53\u524d\u5757\u53d8\u4e3a TODO \u4efb\u52a1", async ({ blockId }) => {
  try {
    const b = await logseq.api.getBlock(blockId);
    if (!b) { logseq.api.notify("\u672a\u627e\u5230\u5f53\u524d\u5757"); return; }
    const rest = String(b.content || "").replace(/^(TODO|DOING|DONE|LATER|NOW|WAITING|CANCELLED)\s+/, "").trim();
    const body = rest || (await logseq.api.prompt("\u4efb\u52a1\u5185\u5bb9\uff1a", "") || "").trim();
    if (!body) { logseq.api.notify("\u672a\u8f93\u5165\u4efb\u52a1\u5185\u5bb9"); return; }
    await logseq.api.updateBlock(blockId, "TODO " + body);
    logseq.api.notify("\u5df2\u521b\u5efa TODO\uff0c\u53ef\u5728\u65e5\u7a0b\u4e2d\u67e5\u770b");
  } catch (e) {
    logseq.api.notify("\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.slash.register("/dv-agenda", "Dataview\uff1a\u63d2\u5165\u4eca\u65e5\u53ca\u5373\u5c06\u5230\u671f\u7684\u4efb\u52a1", async ({ blockId }) => {
  try {
    const rows = await logseq.api.agenda(0);
    if (!rows || rows.length === 0) {
      await replaceBlock(blockId, ["- *\u65e5\u7a0b\u4e3a\u7a7a*"], "\u65e5\u7a0b");
      return;
    }
    const lines = rows.slice(0, 200).map((r) => {
      const mark = r.block && r.block.task_marker ? "[" + r.block.task_marker + "] " : "";
      const date = r.iso_date ? " \u00b7 " + r.iso_date : "";
      const body = truncate((r.block && r.block.content) || "", 100).replace(/^(TODO|DOING|DONE|LATER|NOW|WAITING|CANCELLED)\s+/, "");
      const page = r.page_name ? " \u00b7 [[" + r.page_name + "]]" : "";
      return "- " + mark + body + date + page;
    });
    await replaceBlock(blockId, lines, "\u65e5\u7a0b (" + rows.length + ")");
  } catch (e) {
    logseq.api.notify("\u67e5\u8be2\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.slash.register("/dv-today", "Dataview\uff1a\u63d2\u5165\u4eca\u65e5 journal \u5757", async ({ blockId }) => {
  try {
    const blocks = await logseq.api.blocksForDate(ymdToday());
    if (!blocks || blocks.length === 0) {
      await replaceBlock(blockId, ["- *\u4eca\u5929 journal \u4e3a\u7a7a*"], "\u4eca\u65e5 journal");
      return;
    }
    const lines = blocks.slice(0, 200).map(fmtBlock);
    await replaceBlock(blockId, lines, "\u4eca\u65e5 journal (" + blocks.length + ")");
  } catch (e) {
    logseq.api.notify("\u67e5\u8be2\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.slash.register("/dv-backlinks", "Dataview\uff1a\u63d2\u5165\u5f53\u524d\u9875\u7684\u53cd\u94fe", async ({ blockId }) => {
  try {
    const current = await logseq.api.getCurrentPage();
    if (!current || !current.name) {
      logseq.api.notify("\u672a\u8bc6\u522b\u5230\u5f53\u524d\u9875\u9762");
      return;
    }
    const links = await logseq.api.backlinks(current.name);
    if (!links || links.length === 0) {
      await replaceBlock(blockId, ["- *\u6ca1\u6709\u53cd\u94fe*"], "\u53cd\u94fe \u00b7 " + current.name);
      return;
    }
    const lines = links.slice(0, 200).map(fmtBlock);
    await replaceBlock(blockId, lines, "\u53cd\u94fe \u00b7 " + current.name + " (" + links.length + ")");
  } catch (e) {
    logseq.api.notify("\u67e5\u8be2\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.slash.register("/dv-tag", "Dataview\uff1a\u6309\u6807\u7b7e\u67e5\u8be2", async ({ blockId }) => {
  try {
    const raw = await logseq.api.prompt("\u8f93\u5165\u6807\u7b7e\uff08\u53ef\u5305\u542b #\uff0c\u4f8b\u5982 #\u9879\u76ee\uff09\uff1a", "");
    if (!raw) return;
    const tag = raw.trim().replace(/^#/, "");
    if (!tag) return;
    const hits = await logseq.api.search("#" + tag, 200);
    if (!hits || hits.length === 0) {
      await replaceBlock(blockId, ["- *\u672a\u627e\u5230 #" + tag + "*"], "\u6807\u7b7e \u00b7 #" + tag);
      return;
    }
    const lines = hits
      .filter((h) => h.kind === "block" || h.block_id)
      .slice(0, 200)
      .map((h) => "- " + truncate(h.snippet || h.content || "", 140) + (h.page_name ? " \u00b7 [[" + h.page_name + "]]" : ""));
    await replaceBlock(blockId, lines.length ? lines : ["- *\u672a\u627e\u5230\u5757*"], "\u6807\u7b7e \u00b7 #" + tag + " (" + lines.length + ")");
  } catch (e) {
    logseq.api.notify("\u67e5\u8be2\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.slash.register("/dv-recent", "Dataview\uff1a\u63d2\u5165\u6700\u8fd1\u66f4\u65b0\u9875\u9762", async ({ blockId }) => {
  try {
    const pages = await logseq.api.listPages();
    if (!pages || pages.length === 0) {
      await replaceBlock(blockId, ["- *\u65e0\u9875\u9762*"], "\u6700\u8fd1\u9875\u9762");
      return;
    }
    const sorted = pages
      .filter((p) => !p.journal_day)
      .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
      .slice(0, 30);
    await replaceBlock(blockId, sorted.map(fmtPage), "\u6700\u8fd1\u66f4\u65b0\u9875\u9762 (" + sorted.length + ")");
  } catch (e) {
    logseq.api.notify("\u67e5\u8be2\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.commands.register("dataview-open-tasks", "Dataview\uff1a\u5f39\u7a97\u67e5\u770b\u672a\u5b8c\u6210\u4efb\u52a1", async () => {
  try {
    const tasks = await logseq.api.openTasks();
    const n = tasks ? tasks.length : 0;
    logseq.api.notify("\u5171\u6709 " + n + " \u6761\u672a\u5b8c\u6210\u4efb\u52a1\u3002\u8bf7\u5728\u5757\u4e2d\u8f93\u5165 /dv-tasks \u63d2\u5165\u6e05\u5355\u3002");
  } catch (e) {
    logseq.api.notify("\u67e5\u8be2\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});
`;
