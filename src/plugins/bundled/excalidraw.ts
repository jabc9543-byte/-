// 仿照 Obsidian Excalidraw：基于已经集成的 tldraw 白板，提供新建/打开/嵌入快捷能力。
// - 命令"Excalidraw\uff1a\u65b0\u5efa\u5feb\u901f\u8349\u56fe" \u2192 \u521b\u5efa\u4e00\u4e2a\u4ee5\u65f6\u95f4\u547d\u540d\u7684\u767d\u677f\u5e76\u6253\u5f00
// - /draw \u2192 \u63d0\u793a\u8f93\u5165\u540d\u79f0\u540e\u521b\u5efa\u767d\u677f\uff0c\u5e76\u5728\u5f53\u524d\u5757\u63d2\u5165\u4e00\u6761\u8c03\u8f6c\u94fe\u63a5
// - /draw-list \u2192 \u5217\u51fa\u73b0\u6709\u767d\u677f\u5e76\u63d2\u5165\u5217\u8868

export const EXCALIDRAW_MAIN_JS = String.raw`
function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
    + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

async function createAndOpen(name) {
  const wb = await logseq.api.createWhiteboard(name);
  if (wb && wb.id) {
    await logseq.api.openWhiteboard(wb.id);
  }
  return wb;
}

logseq.commands.register("excalidraw-new", "Excalidraw\uff1a\u65b0\u5efa\u5feb\u901f\u8349\u56fe", async () => {
  try {
    const name = "\u8349\u56fe " + nowStamp();
    const wb = await createAndOpen(name);
    logseq.api.notify("\u5df2\u521b\u5efa\u767d\u677f\uff1a" + (wb && wb.name ? wb.name : name));
  } catch (e) {
    logseq.api.notify("\u521b\u5efa\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.commands.register("excalidraw-list", "Excalidraw\uff1a\u67e5\u770b\u6240\u6709\u767d\u677f", async () => {
  try {
    const list = await logseq.api.listWhiteboards();
    const n = list ? list.length : 0;
    logseq.api.notify("\u73b0\u6709 " + n + " \u4e2a\u767d\u677f\u3002\u8bf7\u5728\u5757\u4e2d\u4f7f\u7528 /draw-list \u63d2\u5165\u6e05\u5355\u3002");
  } catch (e) {
    logseq.api.notify("\u8bfb\u53d6\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.slash.register("/draw", "Excalidraw\uff1a\u65b0\u5efa\u767d\u677f\u5e76\u63d2\u5165\u94fe\u63a5", async ({ blockId }) => {
  try {
    const defName = "\u8349\u56fe " + nowStamp();
    const name = await logseq.api.prompt("\u767d\u677f\u540d\u79f0\uff1a", defName) || defName;
    const wb = await createAndOpen(name);
    if (wb && wb.id) {
      const link = "\ud83c\udfa8 \u767d\u677f\uff1a[[" + wb.name + "]]";
      await logseq.api.updateBlock(blockId, link);
      logseq.api.notify("\u5df2\u6253\u5f00\u767d\u677f\uff1a" + wb.name);
    }
  } catch (e) {
    logseq.api.notify("\u65b0\u5efa\u767d\u677f\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.slash.register("/draw-list", "Excalidraw\uff1a\u63d2\u5165\u767d\u677f\u6e05\u5355", async ({ blockId }) => {
  try {
    const list = await logseq.api.listWhiteboards();
    if (!list || list.length === 0) {
      await logseq.api.updateBlock(blockId, "- *\u8fd8\u6ca1\u6709\u767d\u677f*");
      return;
    }
    const lines = list
      .slice()
      .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
      .slice(0, 100)
      .map((w) => "- \ud83c\udfa8 " + w.name + " \u00b7 " + (w.updated_at || ""));
    await logseq.api.updateBlock(blockId, "**\u767d\u677f\u5217\u8868 (" + list.length + ")**\n" + lines.join("\n"));
  } catch (e) {
    logseq.api.notify("\u8bfb\u53d6\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});
`;
