// Source for the bundled "Daily Notes Template" native plugin.
// The string below is what gets written to <graph>/plugins/<id>/main.js and
// executed inside the plugin sandbox worker.

export const DAILY_NOTES_MAIN_JS = String.raw`
const TEMPLATE = [
  "## \u2705 \u4eca\u65e5\u4efb\u52a1",
  "- TODO ",
  "",
  "## \ud83d\udcdd \u7b14\u8bb0",
  "- ",
  "",
  "## \ud83d\udcad \u590d\u76d8",
  "- \u4eca\u5929\u6700\u6709\u4ef7\u503c\u7684\u4e8b\uff1a",
  "- \u660e\u5929\u8981\u7ee7\u7eed\u63a8\u8fdb\uff1a",
].join("\n");

logseq.slash.register("/template", "\u63d2\u5165\u6bcf\u65e5\u6a21\u677f", async ({ blockId }) => {
  try {
    await logseq.api.updateBlock(blockId, TEMPLATE);
    logseq.api.notify("\u5df2\u63d2\u5165\u6bcf\u65e5\u6a21\u677f");
  } catch (e) {
    logseq.api.notify("\u63d2\u5165\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});

logseq.commands.register("insert-today-template", "\u63d2\u5165\u4eca\u65e5\u6a21\u677f\u5230 journal", async () => {
  try {
    const page = await logseq.api.todayJournal();
    if (!page) {
      logseq.api.notify("\u65e0\u6cd5\u6253\u5f00\u4eca\u65e5 journal");
      return;
    }
    await logseq.api.insertBlock(page.id, null, null, TEMPLATE);
    logseq.api.notify("\u5df2\u5199\u5165\u4eca\u65e5 journal");
  } catch (e) {
    logseq.api.notify("\u5199\u5165\u5931\u8d25\uff1a" + (e && e.message ? e.message : e));
  }
});
`;
