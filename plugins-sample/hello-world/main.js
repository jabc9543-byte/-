// Hello World — reference plugin for Logseq-RS.
//
// The `logseq` global is provided by the host. It exposes command/slash
// registration and a small subset of the app API behind permission flags.

logseq.commands.register("greet", "Hello: say hi", async () => {
  const pages = await logseq.api.listPages();
  logseq.api.notify(`You have ${pages.length} pages. Hello from the plugin!`);
});

logseq.commands.register("count-tasks", "Hello: count blocks", async () => {
  const hits = await logseq.api.search("", 500);
  logseq.api.notify(`Search returned ${hits.length} results.`);
});

logseq.slash.register("/hi", "Insert greeting", async ({ blockId }) => {
  const block = await logseq.api.getBlock(blockId);
  if (!block) return;
  const next = (block.content || "") + "\nHello from the Hello World plugin!";
  await logseq.api.updateBlock(blockId, next);
});

logseq.events.on("page:opened", (payload) => {
  // Demonstrate the event bus; the host emits this when the active page
  // changes. Plugins can silently react — here we just log.
  // eslint-disable-next-line no-console
  console.log("[hello-world] page opened:", payload);
});
