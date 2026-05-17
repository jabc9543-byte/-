// Source for the bundled "Calendar" native plugin.
// Visualizes a month grid in a popup, marks journal-dotted days, and jumps to today.

export const CALENDAR_MAIN_JS = String.raw`
function pad(n) { return String(n).padStart(2, "0"); }
function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

function isJournalName(name) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(name || ""));
}

async function journalSetForMonth(year, month) {
  const pages = await logseq.api.listPages();
  const prefix = year + "-" + pad(month + 1);
  const set = new Set();
  for (const p of pages || []) {
    const name = p && p.name ? p.name : "";
    if (isJournalName(name) && name.startsWith(prefix)) set.add(name);
  }
  return set;
}

function renderMonthAscii(year, month, journalSet) {
  // month is 0-based
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startWeekday = first.getDay(); // 0=Sun
  const days = last.getDate();
  const today = new Date();
  const todayName = ymd(today);

  const head = "  日  一  二  三  四  五  六";
  let cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push("    ");
  for (let d = 1; d <= days; d++) {
    const name = year + "-" + pad(month + 1) + "-" + pad(d);
    const dot = journalSet.has(name) ? "●" : " ";
    let label = pad(d);
    if (name === todayName) label = "[" + label + "]";
    else label = " " + label + " ";
    cells.push(dot + label);
  }
  // 6 行 x 7 列
  let lines = [head];
  for (let i = 0; i < cells.length; i += 7) {
    lines.push(cells.slice(i, i + 7).join(" "));
  }
  return lines.join("\n");
}

async function showCalendar(year, month) {
  const set = await journalSetForMonth(year, month);
  const grid = renderMonthAscii(year, month, set);
  const tip = [
    "● = 那天写过 journal     [日] = 今天",
    "",
    "操作：",
    "  - 输入数字 1~31 跳到那天",
    "  - 输入 < 上一月，> 下一月",
    "  - 输入 t 跳回今天，留空取消",
  ].join("\n");
  const title = year + " 年 " + (month + 1) + " 月";
  const input = await logseq.api.prompt(title + "\n\n" + grid + "\n\n" + tip + "\n\n请输入：", "");
  if (input === null) return;
  const s = String(input || "").trim().toLowerCase();
  if (!s) return;
  if (s === "<") { return showCalendar(month === 0 ? year - 1 : year, (month + 11) % 12); }
  if (s === ">") { return showCalendar(month === 11 ? year + 1 : year, (month + 1) % 12); }
  if (s === "t" || s === "today") {
    const t = new Date();
    return openJournal(t);
  }
  const n = parseInt(s, 10);
  if (!isNaN(n) && n >= 1 && n <= 31) {
    return openJournal(new Date(year, month, n));
  }
}

async function openJournal(d) {
  const name = ymd(d);
  const pages = await logseq.api.listPages();
  let page = (pages || []).find((p) => p.name === name);
  if (!page) {
    await logseq.api.insertBlock(null, null, null, "");
    // listPages again
    const again = await logseq.api.listPages();
    page = again.find((p) => p.name === name);
  }
  if (page) {
    await logseq.api.openPage(page.id);
    logseq.api.notify("已跳到 " + name);
  } else {
    logseq.api.notify("无法创建 " + name + " 的 journal");
  }
}

logseq.commands.register("calendar-open", "Calendar：打开本月日历", async () => {
  const n = new Date();
  await showCalendar(n.getFullYear(), n.getMonth());
});

logseq.commands.register("calendar-today", "Calendar：跳到今天", async () => {
  try {
    const page = await logseq.api.todayJournal();
    if (page) {
      await logseq.api.openPage(page.id);
      logseq.api.notify("已跳到今天的 journal");
    } else {
      logseq.api.notify("打开今天 journal 失败");
    }
  } catch (e) {
    logseq.api.notify("出错：" + (e && e.message ? e.message : e));
  }
});

logseq.slash.register("/calendar", "Calendar：在此处打开日历", async ({ blockId }) => {
  const n = new Date();
  await showCalendar(n.getFullYear(), n.getMonth());
  void blockId;
});
`;
