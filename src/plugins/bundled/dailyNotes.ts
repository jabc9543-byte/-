// Source for the bundled "Daily Notes Template" native plugin.
// The string below is what gets written to <graph>/plugins/<id>/main.js and
// executed inside the plugin sandbox worker.

export const DAILY_NOTES_MAIN_JS = String.raw`
// Each entry becomes a separate top-level block in today's journal so that
// TODO/DOING markers are recognized by the parser and the Agenda picks
// them up automatically.
const SECTIONS = [
  { heading: "## \u2705 \u4eca\u65e5\u4efb\u52a1", children: ["TODO \u4eca\u65e5\u4efb\u52a1\u4e00", "TODO \u4eca\u65e5\u4efb\u52a1\u4e8c"] },
  { heading: "## \ud83d\udcdd \u7b14\u8bb0", children: ["\u8bb0\u5f55\u4eca\u5929\u7684\u601d\u8003\u3001\u9605\u8bfb\u3001\u804a\u5929\u8981\u70b9\u2026"] },
  { heading: "## \ud83d\udcad \u590d\u76d8", children: ["\u4eca\u5929\u6700\u6709\u4ef7\u503c\u7684\u4e8b\uff1a", "\u660e\u5929\u8981\u7ee7\u7eed\u63a8\u8fdb\uff1a"] },
];

async function insertTemplate(pageId, parentId) {
  // Insert each section heading as a sibling block, then its task / note
  // children underneath. parentId === null means write at the page root.
  let lastSibling = null;
  for (const sec of SECTIONS) {
    const head = await logseq.api.insertBlock(pageId, parentId, lastSibling, sec.heading);
    lastSibling = head && head.id ? head.id : lastSibling;
    let lastChild = null;
    for (const child of sec.children) {
      const c = await logseq.api.insertBlock(pageId, head.id, lastChild, child);
      lastChild = c && c.id ? c.id : lastChild;
    }
  }
}

logseq.slash.register("/template", "\u63d2\u5165\u6bcf\u65e5\u6a21\u677f", async ({ blockId }) => {
  try {
    const cur = await logseq.api.getBlock(blockId);
    if (!cur) { logseq.api.notify("\u672a\u627e\u5230\u5f53\u524d\u5757"); return; }
    // Convert current block to the first heading and insert the rest as siblings.
    await logseq.api.updateBlock(blockId, SECTIONS[0].heading);
    let lastChild = null;
    for (const child of SECTIONS[0].children) {
      const c = await logseq.api.insertBlock(cur.page_id, blockId, lastChild, child);
      lastChild = c && c.id ? c.id : lastChild;
    }
    let lastSibling = blockId;
    for (let i = 1; i < SECTIONS.length; i++) {
      const sec = SECTIONS[i];
      const head = await logseq.api.insertBlock(cur.page_id, cur.parent_id, lastSibling, sec.heading);
      lastSibling = head && head.id ? head.id : lastSibling;
      let lc = null;
      for (const child of sec.children) {
        const c = await logseq.api.insertBlock(cur.page_id, head.id, lc, child);
        lc = c && c.id ? c.id : lc;
      }
    }
    logseq.api.notify("\u5df2\u63d2\u5165\u6bcf\u65e5\u6a21\u677f\uff08\u542b TODO \u4efb\u52a1\u5757\uff0c\u53ef\u5728\u201c\u65e5\u7a0b\u201d\u4e2d\u67e5\u770b\uff09");
  } catch (e) {
    logseq.api.notify("\u63d2\u5165\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.commands.register("insert-today-template", "\u63d2\u5165\u4eca\u65e5\u6a21\u677f\u5230 journal", async () => {
  try {
    const page = await logseq.api.todayJournal();
    if (!page) { logseq.api.notify("\u65e0\u6cd5\u6253\u5f00\u4eca\u65e5 journal"); return; }
    await insertTemplate(page.id, null);
    await logseq.api.openPage(page.id);
    logseq.api.notify("\u5df2\u5199\u5165\u4eca\u65e5 journal\uff08TODO \u4efb\u52a1\u5757\u4f1a\u540c\u6b65\u5230\u65e5\u7a0b\uff09");
  } catch (e) {
    logseq.api.notify("\u5199\u5165\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.slash.register("/todo", "\u63d2\u5165\u4e00\u4e2a TODO \u4efb\u52a1\u5757", async ({ blockId }) => {
  try {
    const text = await logseq.api.prompt("\u4efb\u52a1\u5185\u5bb9\uff1a", "");
    if (text === null) return;
    const t = (text || "").trim();
    if (!t) return;
    await logseq.api.updateBlock(blockId, "TODO " + t);
    logseq.api.notify("\u5df2\u521b\u5efa TODO \u4efb\u52a1\uff0c\u53ef\u5728\u65e5\u7a0b\u4e2d\u67e5\u770b");
  } catch (e) {
    logseq.api.notify("\u521b\u5efa\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});
`;
