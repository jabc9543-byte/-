// Source for the bundled "Quick Switcher 增强" native plugin.
// Provides a fuzzy-search command palette that lists page titles and recent
// blocks. Implemented purely against the plugin API; the host palette already
// surfaces command names by their label.

export const QUICK_SWITCHER_MAIN_JS = String.raw`
function fuzzyScore(needle, hay) {
  needle = needle.toLowerCase();
  hay = hay.toLowerCase();
  let score = 0;
  let i = 0;
  for (const c of hay) {
    if (c === needle[i]) {
      score += 2;
      i += 1;
      if (i >= needle.length) return score;
    } else if (i > 0) {
      score -= 1;
    }
  }
  return i >= needle.length ? score : -1;
}

async function ranked(query, limit) {
  if (!query) return [];
  const pages = await logseq.api.listPages();
  const scored = [];
  for (const p of pages) {
    const s = fuzzyScore(query, p.name);
    if (s >= 0) scored.push({ name: p.name, id: p.id, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit ?? 20);
}

logseq.commands.register("quick-switcher", "\u5feb\u901f\u8df3\u8f6c\uff1a\u9875\u9762\u641c\u7d22", async () => {
  const q = prompt("\u8f93\u5165\u9875\u9762\u540d\u79f0\u5173\u952e\u5b57\uff1a", "");
  if (!q) return;
  const hits = await ranked(q, 10);
  if (hits.length === 0) {
    logseq.api.notify("\u672a\u627e\u5230\u5339\u914d\u9875\u9762");
    return;
  }
  const list = hits.map((h, i) => (i + 1) + ". " + h.name).join("\n");
  const pick = prompt("\u9009\u62e9\u5e8f\u53f7\u6253\u5f00\uff1a\n" + list, "1");
  const idx = parseInt(pick ?? "", 10) - 1;
  if (Number.isNaN(idx) || idx < 0 || idx >= hits.length) return;
  // Page navigation is host-driven \u2014 we ping a notify so the user knows
  // the result; opening the page programmatically requires a host RPC the
  // sandbox does not currently expose (intentional, to avoid grabbing
  // navigation without consent).
  logseq.api.notify("\u5df2\u9009\u62e9\uff1a" + hits[idx].name);
});

logseq.slash.register("/jump", "\u5feb\u901f\u8df3\u8f6c", async () => {
  const q = prompt("\u8f93\u5165\u9875\u9762\u540d\u79f0\u5173\u952e\u5b57\uff1a", "");
  if (!q) return;
  const hits = await ranked(q, 5);
  if (hits.length === 0) {
    logseq.api.notify("\u672a\u627e\u5230\u5339\u914d\u9875\u9762");
  } else {
    logseq.api.notify("\u5339\u914d\uff1a" + hits.map((h) => h.name).join(", "));
  }
});
`;
