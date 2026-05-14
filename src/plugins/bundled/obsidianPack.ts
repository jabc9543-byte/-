// 仿 Obsidian 社区插件理念，使用本应用原生 RPC 实现的扩展集合。
// 所有插件均为 MIT 协议开源，作者：全视维 官方。
// 每个插件都以命令面板入口为主（部分附带 slash 触发），保证即装即用。

import type { PluginManifest } from "../../stores/plugins";

export interface ObsidianStylePlugin {
  manifest: PluginManifest;
  source: string;
}

type Perm = "commands" | "slashCommands" | "readBlocks" | "writeBlocks" | "http" | "sidebar";

// 公共前置代码：每个插件都会注入一段轻量 helper（仅在自身 worker 内可见）。
const PREAMBLE = String.raw`
function def(id, label, fn) {
  logseq.commands.register(id, label, fn);
  logseq.slash.register("/" + id, label, function(ctx) { return fn(ctx || {}); });
}
async function _today() { return await logseq.api.todayJournal(); }
async function _current() { let p = await logseq.api.getCurrentPage(); if (!p || !p.id) p = await _today(); return p; }
async function appendToday(text) {
  const p = await _today();
  if (!p || !p.id) { logseq.api.notify("无法获取今日 journal"); return null; }
  await logseq.api.insertBlock(p.id, null, null, text);
  // Surface the result to the user immediately: open the journal page and
  // emit a data-changed event so views like Agenda / Calendar refresh.
  try { await logseq.api.openPage(p.id); } catch (_) {}
  return p.id;
}
async function appendCurrent(text) {
  const p = await _current();
  if (!p || !p.id) { logseq.api.notify("无法定位目标页面"); return null; }
  await logseq.api.insertBlock(p.id, null, null, text);
  try { await logseq.api.openPage(p.id); } catch (_) {}
  return p.id;
}
async function journalBlocks() {
  // Prefer the currently-open journal page's blocks; fall back to today's
  // journal; finally fall back to recursively walking the active page so
  // the plugin still works on a non-journal page.
  let p = await logseq.api.getCurrentPage();
  if (p && p.journal_day) {
    const bs = await logseq.api.blocksForDate(p.journal_day);
    if (bs && bs.length) return bs;
  }
  const today = await _today();
  if (today && today.journal_day) {
    const bs = await logseq.api.blocksForDate(today.journal_day);
    if (bs && bs.length) return bs;
  }
  const cur = p || today;
  if (cur && cur.id) {
    const bs = await logseq.api.pageBlocks(cur.id);
    if (bs && bs.length) return bs;
  }
  return [];
}
function _pad(n) { return n < 10 ? "0" + n : "" + n; }
function ymd(d) { d = d || new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
function dateStr(d) { d = d || new Date(); return d.getFullYear() + "-" + _pad(d.getMonth() + 1) + "-" + _pad(d.getDate()); }
function trunc(s, n) { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "\u2026" : s; }
function notify(m) { logseq.api.notify(m); }
function safe(fn) { return async function() { try { return await fn.apply(null, arguments); } catch (e) { notify("执行失败：" + (e && e.message ? e.message : e)); } }; }
function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shiftDate(d, days) { const x = new Date(d || new Date()); x.setDate(x.getDate() + days); return x; }
async function jumpJournal(date) {
  const y = ymd(date);
  const pages = await logseq.api.listPages();
  const hit = (pages || []).find(function(p) { return p.journal_day === y; });
  if (hit && hit.id) { await logseq.api.openPage(hit.id); notify("已跳转到 " + dateStr(date)); }
  else notify("未找到 " + dateStr(date) + " 的 journal 页（请先创建）");
}
`;

interface PluginSpec {
  id: string;
  name: string;
  icon: string;
  category: string;
  tagline: string;
  perms?: Perm[];
  body: string;
}

function build(spec: PluginSpec): ObsidianStylePlugin {
  const perms = (spec.perms ?? ["commands", "slashCommands", "readBlocks", "writeBlocks"]) as Perm[];
  if (!perms.includes("slashCommands")) perms.push("slashCommands");
  const triggers: string[] = [];
  const labels: string[] = [];
  const reDef = /def\(\s*"([^"]+)"\s*,\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = reDef.exec(spec.body))) {
    triggers.push("/" + m[1]);
    labels.push(m[2]);
  }
  const slashPart = triggers.length ? "斜杠：" + triggers.join("、") : "";
  const cmdPart = labels.length ? "命令：" + labels.join("；") : "";
  const desc = [spec.tagline + "。", slashPart, cmdPart].filter(Boolean).join(" ");
  return {
    manifest: {
      id: "com.logseqrs." + spec.id,
      name: spec.name,
      version: "0.1.0",
      description: desc,
      author: "全视维 官方",
      entry: "main.js",
      permissions: perms,
      kind: "native",
      category: spec.category,
      icon: spec.icon,
      tagline: spec.tagline,
    },
    source: PREAMBLE + "\n" + spec.body,
  };
}

// ----------------- 写作 / 编辑 -----------------

const SPECS: PluginSpec[] = [
  {
    id: "word-counter",
    name: "字数统计",
    icon: "🔢",
    category: "写作",
    tagline: "统计今日 journal 的字数与块数",
    body: String.raw`
def("count-today", "\u5b57\u6570\u7edf\u8ba1\uff1a\u4eca\u65e5 journal / \u5f53\u524d\u9875", safe(async function () {
  const blocks = await journalBlocks();
  if (!blocks || blocks.length === 0) {
    notify("\u5f53\u524d\u9875\u4e0e\u4eca\u65e5 journal \u90fd\u4e3a\u7a7a\uff0c\u8bf7\u5148\u5199\u5165\u4e00\u4e9b\u5185\u5bb9\u540e\u518d\u8c03\u7528\u3002");
    return;
  }
  let chars = 0, words = 0;
  for (const b of blocks) {
    const t = String(b.content || "");
    chars += t.length;
    words += (t.match(/[A-Za-z0-9]+|[\u4e00-\u9fa5]/g) || []).length;
  }
  await appendToday("\u5b57\u6570\u7edf\u8ba1\uff1a\u5171 " + blocks.length + " \u5757 / " + chars + " \u5b57\u7b26 / " + words + " \u8bcd");
  notify("\u5b57\u7b26 " + chars + " \u00b7 \u8bcd " + words + " \u00b7 \u5757 " + blocks.length);
}));`,
  },
  {
    id: "reading-time",
    name: "阅读时长",
    icon: "⏱️",
    category: "写作",
    tagline: "按 300 字/分钟估算今日 journal 阅读时长",
    body: String.raw`
def("reading-time-today", "阅读时长：今日 journal", safe(async function () {
  const blocks = await journalBlocks();
  let chars = 0;
  for (const b of blocks) chars += String(b.content || "").length;
  const mins = Math.max(1, Math.round(chars / 300));
  notify("预计阅读 " + mins + " 分钟（" + chars + " 字符）");
  await appendToday("阅读时长：约 " + mins + " 分钟（" + chars + " 字符）");
}));`,
  },
  {
    id: "toc-generator",
    name: "目录生成",
    icon: "🧭",
    category: "写作",
    tagline: "扫描今日 journal 的标题块，生成目录",
    body: String.raw`
def("toc-today", "目录：生成今日 journal 目录", safe(async function () {
  const blocks = await journalBlocks();
  const lines = [];
  for (const b of blocks) {
    const m = String(b.content || "").match(/^(#{1,6})\s+(.*)/);
    if (m) lines.push("  ".repeat(m[1].length - 1) + "- " + m[2].trim());
  }
  if (!lines.length) { notify("今日 journal 没有 # 标题块"); return; }
  await appendToday("**目录**\n" + lines.join("\n"));
}));`,
  },
  {
    id: "text-sort-lines",
    name: "行排序",
    icon: "🔤",
    category: "写作",
    tagline: "把字符串行升序/降序后写入今日 journal",
    body: String.raw`
def("sort-today-lines", "行排序：今日 journal 所有块（升序）", safe(async function () {
  const blocks = await journalBlocks();
  const lines = blocks.map(function (b) { return String(b.content || "").split(/\n/)[0]; }).filter(Boolean);
  lines.sort(function (a, b) { return a.localeCompare(b, "zh-Hans-CN"); });
  await appendToday("**排序结果**\n" + lines.map(function (l) { return "- " + l; }).join("\n"));
}));`,
  },
  {
    id: "text-unique-lines",
    name: "行去重",
    icon: "🧹",
    category: "写作",
    tagline: "去除今日 journal 中重复的首行",
    body: String.raw`
def("unique-today-lines", "行去重：今日 journal", safe(async function () {
  const blocks = await journalBlocks();
  const seen = new Set();
  const out = [];
  for (const b of blocks) {
    const k = String(b.content || "").split(/\n/)[0].trim();
    if (k && !seen.has(k)) { seen.add(k); out.push("- " + k); }
  }
  await appendToday("**去重结果（共 " + out.length + "）**\n" + out.join("\n"));
}));`,
  },
  {
    id: "case-converter",
    name: "大小写转换",
    icon: "🔠",
    category: "写作",
    tagline: "向今日 journal 追加示例：上下标 / Title / UPPER / lower",
    body: String.raw`
def("case-demo", "大小写：写入对照示例", safe(async function () {
  const seed = "logseq rs is a local first knowledge base";
  await appendToday(
    "**大小写演示**\n" +
    "- 原文：" + seed + "\n" +
    "- UPPER：" + seed.toUpperCase() + "\n" +
    "- lower：" + seed.toLowerCase() + "\n" +
    "- Title：" + seed.replace(/\b\w/g, function (c) { return c.toUpperCase(); })
  );
}));`,
  },
  {
    id: "emoji-cheatsheet",
    name: "Emoji 速查",
    icon: "😀",
    category: "写作",
    tagline: "插入一份常用 emoji 速查表到今日 journal",
    body: String.raw`
const SHEET = [
  ["✅ 完成", "❌ 失败", "⚠️ 警告", "💡 灵感", "📌 钉住", "🔥 高优"],
  ["📝 笔记", "📚 阅读", "🧠 思考", "🎯 目标", "⏰ 提醒", "📅 日程"],
  ["😄 开心", "😴 累", "🤔 疑问", "🥳 庆祝", "🙏 感谢", "💪 加油"],
];
def("emoji-sheet", "Emoji：插入速查表", safe(async function () {
  await appendToday("**Emoji 速查**\n" + SHEET.map(function (r) { return "- " + r.join(" · "); }).join("\n"));
}));`,
  },
  {
    id: "lorem-ipsum",
    name: "Lorem Ipsum",
    icon: "🧪",
    category: "写作",
    tagline: "向今日 journal 追加占位文本（中英双语）",
    body: String.raw`
const EN = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";
const ZH = "在此插入占位文字以测试排版与节奏，请勿当作正式内容阅读。";
def("lorem-en", "Lorem：英文占位", safe(async function () { await appendToday(EN); }));
def("lorem-zh", "Lorem：中文占位", safe(async function () { await appendToday(ZH); }));`,
  },
  {
    id: "ascii-banner",
    name: "ASCII 横幅",
    icon: "🪧",
    category: "写作",
    tagline: "为今日 journal 写入一条 ASCII 风格分隔横幅",
    body: String.raw`
function banner(text) {
  const bar = "=".repeat(Math.max(8, text.length + 4));
  return "+" + bar + "+\n|  " + text + "  |\n+" + bar + "+";
}
def("banner-day", "ASCII：今日横幅", safe(async function () { await appendToday(banner(dateStr())); }));
def("banner-focus", "ASCII：FOCUS 横幅", safe(async function () { await appendToday(banner("FOCUS")); }));`,
  },
  {
    id: "checklist-toggle",
    name: "Checklist 统计",
    icon: "☑️",
    category: "写作",
    tagline: "统计今日 journal 中 - [ ] / - [x] 完成率",
    body: String.raw`
def("checklist-stats", "Checklist：今日完成率", safe(async function () {
  const blocks = await journalBlocks();
  let total = 0, done = 0;
  for (const b of blocks) {
    const text = String(b.content || "");
    const open = (text.match(/-\s\[\s\]/g) || []).length;
    const ok = (text.match(/-\s\[x\]/gi) || []).length;
    total += open + ok; done += ok;
  }
  const rate = total ? Math.round((done * 100) / total) : 0;
  notify("Checklist：" + done + "/" + total + " (" + rate + "%)");
  await appendToday("Checklist 完成率：" + done + "/" + total + " (" + rate + "%)");
}));`,
  },

  // ----------------- 任务 / GTD -----------------
  {
    id: "pomodoro",
    name: "番茄钟",
    icon: "🍅",
    category: "任务",
    tagline: "25 分钟专注 + 5 分钟休息（系统通知）",
    body: String.raw`
let timer = null;
function start(label, mins) {
  if (timer) { clearTimeout(timer); timer = null; }
  notify("番茄钟 · " + label + " 开始：" + mins + " 分钟");
  timer = setTimeout(function () {
    notify("番茄钟 · " + label + " 结束");
    appendToday("🍅 番茄钟 · " + label + " · " + mins + "min · " + dateStr(new Date()));
    timer = null;
  }, mins * 60 * 1000);
}
def("pomo-25", "番茄钟：开始 25 分钟专注", function () { start("专注", 25); });
def("pomo-5", "番茄钟：开始 5 分钟休息", function () { start("休息", 5); });
def("pomo-stop", "番茄钟：停止当前计时", function () { if (timer) { clearTimeout(timer); timer = null; notify("已停止番茄钟"); } else notify("当前没有计时"); });`,
  },
  {
    id: "habit-tracker",
    name: "习惯打卡",
    icon: "🎯",
    category: "任务",
    tagline: "一键写入「阅读 / 运动 / 冥想」三项打卡到今日 journal",
    body: String.raw`
def("habit-checkin", "习惯：今日三项打卡", safe(async function () {
  await appendToday("**今日打卡**\n- [ ] 📖 阅读\n- [ ] 🏃 运动\n- [ ] 🧘 冥想");
  notify("已写入今日打卡");
}));
def("habit-streak", "习惯：扫描连续打卡天数", safe(async function () {
  const pages = (await logseq.api.listPages()) || [];
  const days = pages.filter(function (p) { return p.journal_day; }).sort(function (a, b) { return b.journal_day - a.journal_day; });
  let streak = 0;
  for (const p of days) {
    const bs = await logseq.api.blocksForDate(p.journal_day);
    if ((bs || []).some(function (b) { return /打卡|habit|checkin/i.test(String(b.content || "")); })) streak++;
    else break;
  }
  notify("连续打卡天数：" + streak);
  await appendToday("习惯连续打卡：" + streak + " 天");
}));`,
  },
  {
    id: "eat-the-frog",
    name: "吃掉那只青蛙",
    icon: "🐸",
    category: "任务",
    tagline: "写入今日「最重要的一件事」",
    body: String.raw`
def("frog-today", "GTD：写入「今日青蛙」", safe(async function () {
  await appendToday("**🐸 今日最重要的一件事**\n- TODO ");
  notify("已写入青蛙占位，请把它替换为真正最重要的事");
}));`,
  },
  {
    id: "eisenhower-matrix",
    name: "艾森豪威尔矩阵",
    icon: "🟦",
    category: "任务",
    tagline: "插入四象限模板（重要/紧急）",
    body: String.raw`
const M = [
  "**艾森豪威尔矩阵**",
  "- 🔥 重要且紧急",
  "  - TODO ",
  "- 🌱 重要不紧急",
  "  - TODO ",
  "- ⚡ 紧急不重要",
  "  - TODO ",
  "- 🗑️ 不重要不紧急",
  "  - TODO ",
].join("\n");
def("eisenhower", "GTD：插入艾森豪威尔矩阵", safe(async function () { await appendToday(M); }));`,
  },
  {
    id: "weekly-review",
    name: "每周复盘",
    icon: "🗓️",
    category: "任务",
    tagline: "插入「上周完成 / 本周计划 / 反思」模板",
    body: String.raw`
const TPL = [
  "**📅 每周复盘 · " + "{DATE}" + "**",
  "## 🏆 上周完成",
  "- ",
  "## 🎯 本周计划",
  "- TODO ",
  "## 🔍 反思",
  "- 做得好的：",
  "- 需要改进的：",
].join("\n");
def("weekly-review", "GTD：插入每周复盘", safe(async function () {
  await appendToday(TPL.replace("{DATE}", dateStr(new Date())));
}));`,
  },
  {
    id: "okr-template",
    name: "OKR 模板",
    icon: "🎯",
    category: "任务",
    tagline: "插入 Objective + 3 Key Results 模板",
    body: String.raw`
const OKR = [
  "**OKR · " + "{DATE}" + "**",
  "- 🎯 Objective：",
  "  - 📈 KR1 ",
  "  - 📈 KR2 ",
  "  - 📈 KR3 ",
].join("\n");
def("okr-insert", "OKR：插入模板", safe(async function () {
  await appendToday(OKR.replace("{DATE}", dateStr()));
}));`,
  },
  {
    id: "swot-template",
    name: "SWOT 分析",
    icon: "🧩",
    category: "任务",
    tagline: "插入 SWOT 四象限模板",
    body: String.raw`
const SWOT = [
  "**SWOT 分析**",
  "- 💪 Strengths（优势）",
  "- 🔻 Weaknesses（劣势）",
  "- 🌅 Opportunities（机会）",
  "- ⚠️ Threats（威胁）",
].join("\n");
def("swot-insert", "SWOT：插入模板", safe(async function () { await appendToday(SWOT); }));`,
  },
  {
    id: "one-on-one",
    name: "1:1 会议",
    icon: "🤝",
    category: "任务",
    tagline: "插入「上次行动 / 主题 / Next Steps」模板",
    body: String.raw`
const ONE = [
  "**🤝 1:1 · " + "{DATE}" + "**",
  "## 上次的行动项",
  "- ",
  "## 本次主题",
  "- ",
  "## Next Steps",
  "- TODO ",
].join("\n");
def("one-on-one", "1:1：插入模板", safe(async function () {
  await appendToday(ONE.replace("{DATE}", dateStr()));
}));`,
  },

  // ----------------- 日记 -----------------
  {
    id: "on-this-day",
    name: "On This Day",
    icon: "📜",
    category: "日记",
    tagline: "汇总过去五年同月同日的 journal 内容",
    body: String.raw`
def("on-this-day", "日记：On This Day", safe(async function () {
  const now = new Date();
  const lines = [];
  for (let i = 1; i <= 5; i++) {
    const d = new Date(now); d.setFullYear(d.getFullYear() - i);
    const bs = (await logseq.api.blocksForDate(ymd(d))) || [];
    if (bs.length) {
      lines.push("**" + d.getFullYear() + "**");
      for (const b of bs.slice(0, 10)) lines.push("- " + trunc(b.content, 120));
    }
  }
  await appendToday(lines.length ? "📜 On This Day\n" + lines.join("\n") : "📜 On This Day：往年同日为空");
}));`,
  },
  {
    id: "five-year-journal",
    name: "五年日记",
    icon: "🗒️",
    category: "日记",
    tagline: "在今日 journal 追加近五年同日条目（每年 1 条）",
    body: String.raw`
def("five-year-journal", "日记：五年同日", safe(async function () {
  const now = new Date();
  const lines = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(now); d.setFullYear(d.getFullYear() - i);
    const bs = (await logseq.api.blocksForDate(ymd(d))) || [];
    lines.push("- " + d.getFullYear() + "：" + (bs[0] ? trunc(bs[0].content, 120) : "（空）"));
  }
  await appendToday("**五年日记**\n" + lines.join("\n"));
}));`,
  },
  {
    id: "mood-tracker",
    name: "心情记录",
    icon: "🌈",
    category: "日记",
    tagline: "一键追加心情打分（1–5）",
    body: String.raw`
function mk(n) { return "心情 · " + dateStr() + " · " + n + "/5 · " + "★".repeat(n) + "☆".repeat(5 - n); }
for (let i = 1; i <= 5; i++) {
  (function (n) {
    def("mood-" + n, "心情：今日 " + n + " 分", safe(async function () { await appendToday(mk(n)); notify("已记录心情：" + n + "/5"); }));
  })(i);
}`,
  },
  {
    id: "gratitude-log",
    name: "感恩日记",
    icon: "🙏",
    category: "日记",
    tagline: "一键插入「今日三件值得感恩的事」模板",
    body: String.raw`
const G = [
  "**🙏 今日感恩**",
  "- 1. ",
  "- 2. ",
  "- 3. ",
].join("\n");
def("gratitude-3", "感恩：插入三件事", safe(async function () { await appendToday(G); }));`,
  },
  {
    id: "random-prompt",
    name: "写作灵感",
    icon: "💭",
    category: "日记",
    tagline: "从内置池中随机抽取一个写作题目到今日 journal",
    body: String.raw`
const POOL = [
  "写下让你今天微笑的一件小事。",
  "如果你能给昨天的自己一句话建议，会是什么？",
  "用 5 句话描述你理想中的一天。",
  "最近一次离开舒适区是什么时候？",
  "如果今天是你最后一天，你会怎样度过？",
  "记录一个你想感谢但还没说出口的人。",
  "你最近重复学到的一个教训是什么？",
];
def("prompt-random", "灵感：随机写作题目", safe(async function () {
  await appendToday("**💭 今日灵感**\n- " + rnd(POOL));
}));`,
  },
  {
    id: "weather-stamp",
    name: "天气印戳",
    icon: "🌤️",
    category: "日记",
    tagline: "调用 wttr.in 获取一句话天气并追加到今日 journal",
    perms: ["commands", "readBlocks", "writeBlocks", "http"],
    body: String.raw`
def("weather-stamp", "天气：写入今日天气", safe(async function () {
  // wttr.in expects literal %l/%C/%t/%w placeholders; encode them in the URL
  // so reqwest's strict URL parser accepts the request.
  const url = "https://wttr.in/?format=%25l%3A+%25C+%25t+%25w&lang=zh-cn";
  const res = await logseq.api.httpFetch(url, { headers: { "User-Agent": "curl/8" } });
  const line = String((res && res.body) || "").trim();
  if (!line || /^\s*<!DOCTYPE/i.test(line)) { notify("未取到天气（接口返回 HTML，可能被本地网络拦截）"); return; }
  await appendToday("🌤️ " + line);
  notify(line);
}));
def("weather-city", "天气：按城市写入", safe(async function () {
  const city = await logseq.api.prompt("城市（拼音或英文，如 beijing / Shanghai）：", "beijing");
  if (city === null) return;
  const url = "https://wttr.in/" + encodeURIComponent(city.trim()) + "?format=%25l%3A+%25C+%25t+%25w&lang=zh-cn";
  const res = await logseq.api.httpFetch(url, { headers: { "User-Agent": "curl/8" } });
  const line = String((res && res.body) || "").trim();
  if (!line) { notify("未取到天气"); return; }
  await appendToday("🌤️ " + line);
  notify(line);
}));`,
  },
  {
    id: "quote-of-day",
    name: "每日金句",
    icon: "💬",
    category: "日记",
    tagline: "调用 quotable.io 获取一句励志金句",
    perms: ["commands", "readBlocks", "writeBlocks", "http"],
    body: String.raw`
def("quote-of-day", "金句：写入今日一句", safe(async function () {
  const res = await logseq.api.httpFetch("https://api.quotable.io/random");
  let q = "", a = "";
  try { const o = JSON.parse(res.body); q = o.content; a = o.author; } catch (e) {}
  if (!q) { notify("未取到金句"); return; }
  await appendToday("💬 “" + q + "” —— " + a);
}));`,
  },
  {
    id: "this-year-pages",
    name: "今年的页面",
    icon: "🧭",
    category: "日记",
    tagline: "列出本年度所有 journal 页（最多 60 条）",
    body: String.raw`
def("this-year-pages", "导航：本年度 journal 概览", safe(async function () {
  const y = new Date().getFullYear();
  const pages = (await logseq.api.listPages()) || [];
  const list = pages
    .filter(function (p) { return p.journal_day && Math.floor(p.journal_day / 10000) === y; })
    .sort(function (a, b) { return b.journal_day - a.journal_day; })
    .slice(0, 60);
  await appendToday("**" + y + " 年 journal（最近 " + list.length + "）**\n" + list.map(function (p) { return "- [[" + p.name + "]]"; }).join("\n"));
}));`,
  },

  // ----------------- 引用 / 反链 -----------------
  {
    id: "random-note",
    name: "随机笔记",
    icon: "🎲",
    category: "导航",
    tagline: "随机打开一个非 journal 页面",
    body: String.raw`
def("random-note", "导航：打开随机笔记", safe(async function () {
  const pages = ((await logseq.api.listPages()) || []).filter(function (p) { return !p.journal_day; });
  if (!pages.length) { notify("没有可用页面"); return; }
  const pick = rnd(pages);
  await logseq.api.openPage(pick.id);
  notify("跳转到 " + pick.name);
}));`,
  },
  {
    id: "orphan-pages",
    name: "孤立页面",
    icon: "🪦",
    category: "导航",
    tagline: "列出没有反链的页面（潜在孤岛笔记）",
    body: String.raw`
def("orphan-pages", "导航：扫描孤立页面", safe(async function () {
  const pages = ((await logseq.api.listPages()) || []).filter(function (p) { return !p.journal_day; });
  const orphans = [];
  for (const p of pages.slice(0, 200)) {
    const bl = (await logseq.api.backlinks(p.name)) || [];
    if (!bl.length) orphans.push(p);
    if (orphans.length >= 80) break;
  }
  await appendToday("**🪦 孤立页面（" + orphans.length + "）**\n" + orphans.map(function (p) { return "- [[" + p.name + "]]"; }).join("\n"));
}));`,
  },
  {
    id: "dead-link-scan",
    name: "无效链接扫描",
    icon: "🩹",
    category: "导航",
    tagline: "扫描今日 journal 中 [[X]] 但目标页不存在的链接",
    body: String.raw`
def("dead-links-today", "扫描：今日 journal 无效双链", safe(async function () {
  const pages = (await logseq.api.listPages()) || [];
  const known = new Set(pages.map(function (p) { return p.name; }));
  const blocks = await journalBlocks();
  const dead = new Set();
  for (const b of blocks) {
    const t = String(b.content || "");
    const m = t.match(/\[\[([^\]]+)\]\]/g) || [];
    for (const x of m) {
      const name = x.slice(2, -2);
      if (!known.has(name)) dead.add(name);
    }
  }
  const list = Array.from(dead);
  await appendToday("**🩹 无效双链（" + list.length + "）**\n" + (list.length ? list.map(function (n) { return "- [[" + n + "]]"; }).join("\n") : "- *无*"));
}));`,
  },
  {
    id: "tag-cloud",
    name: "标签云",
    icon: "🏷️",
    category: "导航",
    tagline: "统计页面与块中出现的 #标签 频次（取前 30）",
    body: String.raw`
def("tag-cloud", "导航：生成标签云", safe(async function () {
  const blocks = await journalBlocks();
  const counter = new Map();
  for (const b of blocks) {
    const tags = String(b.content || "").match(/#[\w\u4e00-\u9fa5\-]+/g) || [];
    for (const t of tags) counter.set(t, (counter.get(t) || 0) + 1);
  }
  const top = Array.from(counter.entries()).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 30);
  if (!top.length) { notify("今日 journal 没有 # 标签"); return; }
  await appendToday("**🏷️ 标签云（今日）**\n" + top.map(function (e) { return "- " + e[0] + " × " + e[1]; }).join("\n"));
}));`,
  },
  {
    id: "backlink-count",
    name: "反链计数",
    icon: "🔗",
    category: "导航",
    tagline: "弹出通知显示当前页面被引用次数",
    body: String.raw`
def("backlink-count", "反链：当前页计数", safe(async function () {
  const p = await logseq.api.getCurrentPage();
  if (!p || !p.name) { notify("未识别当前页"); return; }
  const bl = (await logseq.api.backlinks(p.name)) || [];
  notify(p.name + " · 反链 " + bl.length + " 处");
}));`,
  },
  {
    id: "recent-edits",
    name: "最近编辑",
    icon: "🕒",
    category: "导航",
    tagline: "把最近编辑的 30 个非 journal 页面写入今日 journal",
    body: String.raw`
def("recent-edits", "导航：最近编辑 30 个页面", safe(async function () {
  const pages = ((await logseq.api.listPages()) || [])
    .filter(function (p) { return !p.journal_day; })
    .sort(function (a, b) { return String(b.updated_at || "").localeCompare(String(a.updated_at || "")); })
    .slice(0, 30);
  await appendToday("**🕒 最近编辑**\n" + pages.map(function (p) { return "- [[" + p.name + "]]"; }).join("\n"));
}));`,
  },

  // ----------------- 查询 / 视图 -----------------
  {
    id: "tasks-by-tag",
    name: "标签任务汇总",
    icon: "📋",
    category: "查询",
    tagline: "把含 #important 标签的未完成任务列到今日 journal",
    body: String.raw`
def("tasks-by-tag-important", "任务：列出 #important", safe(async function () {
  const all = (await logseq.api.openTasks()) || [];
  const list = all.filter(function (b) { return /#important/i.test(String(b.content || "")); });
  await appendToday("**📋 #important 任务（" + list.length + "）**\n" + (list.length ? list.map(function (b) { return "- [" + (b.task_marker || "TODO") + "] " + trunc(b.content, 120); }).join("\n") : "- *无*"));
}));
def("tasks-by-tag-project", "任务：列出 #project", safe(async function () {
  const all = (await logseq.api.openTasks()) || [];
  const list = all.filter(function (b) { return /#project/i.test(String(b.content || "")); });
  await appendToday("**📋 #project 任务（" + list.length + "）**\n" + (list.length ? list.map(function (b) { return "- [" + (b.task_marker || "TODO") + "] " + trunc(b.content, 120); }).join("\n") : "- *无*"));
}));`,
  },
  {
    id: "kanban-template",
    name: "看板模板",
    icon: "🗂️",
    category: "查询",
    tagline: "在今日 journal 插入「Todo / Doing / Done」三栏",
    body: String.raw`
const K = [
  "**🗂️ 今日看板**",
  "## 📥 Todo",
  "- TODO ",
  "## ⚙️ Doing",
  "- DOING ",
  "## ✅ Done",
  "- DONE ",
].join("\n");
def("kanban-insert", "看板：插入三栏模板", safe(async function () { await appendToday(K); }));`,
  },
  {
    id: "today-mentions",
    name: "今日提及",
    icon: "📣",
    category: "查询",
    tagline: "查找包含 YYYY-MM-DD 字符串的块（提及今天）",
    body: String.raw`
def("today-mentions", "查询：被提及（YYYY-MM-DD）", safe(async function () {
  const q = dateStr();
  const hits = (await logseq.api.search(q, 60)) || [];
  await appendToday("**📣 提及 " + q + "（" + hits.length + "）**\n" + hits.map(function (h) { return "- " + trunc(h.snippet || h.content || "", 120) + (h.page_name ? " · [[" + h.page_name + "]]" : ""); }).join("\n"));
}));`,
  },
  {
    id: "status-summary",
    name: "状态汇总",
    icon: "📊",
    category: "查询",
    tagline: "统计 TODO / DOING / DONE / WAITING 总数",
    body: String.raw`
def("status-summary", "查询：任务状态分布", safe(async function () {
  const all = (await logseq.api.openTasks()) || [];
  const c = { TODO: 0, DOING: 0, WAITING: 0, LATER: 0, NOW: 0 };
  for (const b of all) {
    const m = (b.task_marker || "").toUpperCase();
    if (c[m] != null) c[m]++; else c[m] = 1;
  }
  const lines = Object.keys(c).map(function (k) { return "- " + k + "：" + c[k]; });
  await appendToday("**📊 未完成任务分布**\n" + lines.join("\n"));
}));`,
  },
  {
    id: "quick-stats",
    name: "知识库统计",
    icon: "📦",
    category: "查询",
    tagline: "通知页面数 / journal 数 / 今日块数",
    body: String.raw`
def("quick-stats", "统计：知识库一览", safe(async function () {
  const pages = (await logseq.api.listPages()) || [];
  const journals = pages.filter(function (p) { return p.journal_day; }).length;
  const today = (await journalBlocks()).length;
  notify("页面 " + pages.length + " · journal " + journals + " · 今日块 " + today);
  await appendToday("📦 页面 " + pages.length + " · journal " + journals + " · 今日块 " + today);
}));`,
  },
  {
    id: "page-search-export",
    name: "搜索导出",
    icon: "🔎",
    category: "查询",
    tagline: "把固定关键词命中结果写入今日 journal（默认 TODO）",
    body: String.raw`
async function run(q) {
  const hits = (await logseq.api.search(q, 80)) || [];
  await appendToday("**🔎 搜索：" + q + "（" + hits.length + "）**\n" + hits.slice(0, 80).map(function (h) { return "- " + trunc(h.snippet || h.content || "", 120) + (h.page_name ? " · [[" + h.page_name + "]]" : ""); }).join("\n"));
}
def("search-todo", "搜索：TODO", safe(function () { return run("TODO"); }));
def("search-doing", "搜索：DOING", safe(function () { return run("DOING"); }));
def("search-question", "搜索：?? 待澄清", safe(function () { return run("??"); }));`,
  },

  // ----------------- 白板 -----------------
  {
    id: "mindmap-starter",
    name: "思维导图",
    icon: "🧠",
    category: "白板",
    tagline: "一键新建命名为「思维导图 · YYYY-MM-DD」的白板",
    body: String.raw`
def("mindmap-new", "白板：新建思维导图", safe(async function () {
  const id = await logseq.api.createWhiteboard("思维导图 · " + dateStr());
  if (id) { await logseq.api.openWhiteboard(id); notify("已创建思维导图白板"); }
}));`,
  },
  {
    id: "flowchart-starter",
    name: "流程图",
    icon: "🔀",
    category: "白板",
    tagline: "一键新建命名为「流程图 · YYYY-MM-DD」的白板",
    body: String.raw`
def("flowchart-new", "白板：新建流程图", safe(async function () {
  const id = await logseq.api.createWhiteboard("流程图 · " + dateStr());
  if (id) { await logseq.api.openWhiteboard(id); notify("已创建流程图白板"); }
}));`,
  },
  {
    id: "kanban-whiteboard",
    name: "看板白板",
    icon: "🧱",
    category: "白板",
    tagline: "新建白板用作今日看板",
    body: String.raw`
def("kanban-board-new", "白板：新建今日看板", safe(async function () {
  const id = await logseq.api.createWhiteboard("看板 · " + dateStr());
  if (id) { await logseq.api.openWhiteboard(id); notify("已创建看板白板"); }
}));`,
  },
  {
    id: "org-chart-starter",
    name: "组织图",
    icon: "🏛️",
    category: "白板",
    tagline: "新建一个用于绘制组织结构的白板",
    body: String.raw`
def("orgchart-new", "白板：新建组织图", safe(async function () {
  const id = await logseq.api.createWhiteboard("组织图 · " + dateStr());
  if (id) { await logseq.api.openWhiteboard(id); notify("已创建组织图白板"); }
}));`,
  },

  // ----------------- 网络 / 剪藏 -----------------
  {
    id: "url-quick-fetch",
    name: "URL 抓取",
    icon: "🌐",
    category: "网络",
    tagline: "抓取 https://example.com 标题并通过 receiveClip 入库",
    perms: ["commands", "readBlocks", "writeBlocks", "http"],
    body: String.raw`
async function clip(url) {
  const res = await logseq.api.httpFetch(url);
  const m = (res.body || "").match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = m ? m[1].trim() : url;
  await logseq.api.receiveClip({ title: title, url: url, body: "由 URL 抓取插件抓取自 " + url, mode: "journal" });
  notify("已剪藏：" + title);
}
def("clip-example", "网络：剪藏 example.com", safe(function () { return clip("https://example.com"); }));
def("clip-tauri", "网络：剪藏 tauri.app", safe(function () { return clip("https://tauri.app"); }));`,
  },
  {
    id: "youtube-notes",
    name: "YouTube 笔记",
    icon: "▶️",
    category: "网络",
    tagline: "把一份 YouTube 笔记模板写入今日 journal",
    body: String.raw`
const Y = [
  "**▶️ YouTube 笔记 · " + "{DATE}" + "**",
  "- 视频：",
  "- 链接：",
  "- 关键 takeaway：",
  "  - ",
  "- 待办：",
  "  - TODO ",
].join("\n");
def("yt-notes", "模板：YouTube 笔记", safe(async function () { await appendToday(Y.replace("{DATE}", dateStr())); }));`,
  },
  {
    id: "github-repo-info",
    name: "GitHub 仓库信息",
    icon: "🐙",
    category: "网络",
    tagline: "查询 jabc9543-byte/- 仓库信息并写入今日 journal",
    perms: ["commands", "readBlocks", "writeBlocks", "http"],
    body: String.raw`
async function info(repo) {
  const res = await logseq.api.httpFetch("https://api.github.com/repos/" + repo);
  let obj = {}; try { obj = JSON.parse(res.body); } catch (e) {}
  await appendToday("**🐙 " + repo + "**\n- ⭐ " + (obj.stargazers_count || 0) + " · 🍴 " + (obj.forks_count || 0) + " · 🐛 " + (obj.open_issues_count || 0));
}
def("gh-self", "GitHub：查看本仓库", safe(function () { return info("jabc9543-byte/-"); }));`,
  },
  {
    id: "wikipedia-summary",
    name: "维基百科摘要",
    icon: "📚",
    category: "网络",
    tagline: "查询固定词条「知识管理」的中文摘要",
    perms: ["commands", "readBlocks", "writeBlocks", "http"],
    body: String.raw`
async function wiki(term) {
  const url = "https://zh.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(term);
  const res = await logseq.api.httpFetch(url);
  let obj = {}; try { obj = JSON.parse(res.body); } catch (e) {}
  const extract = obj.extract || "（无摘要）";
  await appendToday("**📚 " + term + "**\n" + extract);
}
def("wiki-km", "维基：知识管理", safe(function () { return wiki("知识管理"); }));
def("wiki-pkm", "维基：个人知识管理", safe(function () { return wiki("个人知识管理"); }));`,
  },
  {
    id: "hacker-news-top",
    name: "Hacker News Top",
    icon: "🟧",
    category: "网络",
    tagline: "拉取 HN 头条 10 条标题写入今日 journal",
    perms: ["commands", "readBlocks", "writeBlocks", "http"],
    body: String.raw`
def("hn-top", "Hacker News：Top 10", safe(async function () {
  const ids = JSON.parse((await logseq.api.httpFetch("https://hacker-news.firebaseio.com/v0/topstories.json")).body).slice(0, 10);
  const items = [];
  for (const id of ids) {
    const it = JSON.parse((await logseq.api.httpFetch("https://hacker-news.firebaseio.com/v0/item/" + id + ".json")).body);
    if (it && it.title) items.push("- [" + it.title + "](" + (it.url || ("https://news.ycombinator.com/item?id=" + id)) + ")");
  }
  await appendToday("**🟧 Hacker News Top 10**\n" + items.join("\n"));
}));`,
  },

  // ----------------- 模板 -----------------
  {
    id: "meeting-notes",
    name: "会议纪要",
    icon: "🗣️",
    category: "模板",
    tagline: "插入「与会人 / 议题 / 结论 / 行动项」模板",
    body: String.raw`
const T = [
  "**🗣️ 会议纪要 · " + "{DATE}" + "**",
  "- 与会人：",
  "- 议题：",
  "## 讨论",
  "- ",
  "## 结论",
  "- ",
  "## 行动项",
  "- TODO ",
].join("\n");
def("meeting-notes", "模板：会议纪要", safe(async function () { await appendToday(T.replace("{DATE}", dateStr())); }));`,
  },
  {
    id: "book-notes",
    name: "读书笔记",
    icon: "📖",
    category: "模板",
    tagline: "插入「书名 / 作者 / 金句 / 行动」模板",
    body: String.raw`
const T = [
  "**📖 读书笔记**",
  "- 书名：",
  "- 作者：",
  "- 评分（1–5）：",
  "## 金句",
  "- ",
  "## 我的思考",
  "- ",
  "## 行动",
  "- TODO ",
].join("\n");
def("book-notes", "模板：读书笔记", safe(async function () { await appendToday(T); }));`,
  },
  {
    id: "movie-notes",
    name: "观影记录",
    icon: "🎬",
    category: "模板",
    tagline: "插入「片名 / 导演 / 评分 / 感想」模板",
    body: String.raw`
const T = [
  "**🎬 观影记录**",
  "- 片名：",
  "- 导演：",
  "- 评分（1–5）：",
  "## 感想",
  "- ",
].join("\n");
def("movie-notes", "模板：观影记录", safe(async function () { await appendToday(T); }));`,
  },
  {
    id: "recipe-notes",
    name: "食谱卡片",
    icon: "🍳",
    category: "模板",
    tagline: "插入「食材 / 步骤 / 备注」模板",
    body: String.raw`
const T = [
  "**🍳 食谱**",
  "- 菜名：",
  "- 用时：",
  "## 食材",
  "- ",
  "## 步骤",
  "1. ",
  "2. ",
  "## 备注",
  "- ",
].join("\n");
def("recipe-notes", "模板：食谱", safe(async function () { await appendToday(T); }));`,
  },
  {
    id: "project-brief",
    name: "项目简报",
    icon: "📁",
    category: "模板",
    tagline: "插入「目标 / 范围 / 里程碑 / 风险」模板",
    body: String.raw`
const T = [
  "**📁 项目简报**",
  "- 项目：",
  "- 负责人：",
  "## 目标",
  "- ",
  "## 范围",
  "- ",
  "## 里程碑",
  "- ",
  "## 风险",
  "- ",
].join("\n");
def("project-brief", "模板：项目简报", safe(async function () { await appendToday(T); }));`,
  },
  {
    id: "bug-report",
    name: "Bug 报告",
    icon: "🐞",
    category: "模板",
    tagline: "插入「环境 / 重现 / 期望 / 实际」模板",
    body: String.raw`
const T = [
  "**🐞 Bug 报告**",
  "- 环境：",
  "- 重现步骤：",
  "  1. ",
  "  2. ",
  "- 期望：",
  "- 实际：",
  "- 日志：",
].join("\n");
def("bug-report", "模板：Bug 报告", safe(async function () { await appendToday(T); }));`,
  },
  {
    id: "cornell-notes",
    name: "康奈尔笔记",
    icon: "🗒️",
    category: "模板",
    tagline: "插入「线索 / 笔记 / 总结」三栏模板",
    body: String.raw`
const T = [
  "**🗒️ 康奈尔笔记**",
  "## 线索（提问 / 关键词）",
  "- ",
  "## 笔记",
  "- ",
  "## 总结",
  "- ",
].join("\n");
def("cornell-notes", "模板：康奈尔笔记", safe(async function () { await appendToday(T); }));`,
  },
  {
    id: "zettelkasten",
    name: "Zettel 卡片",
    icon: "🃏",
    category: "模板",
    tagline: "插入永久笔记（Zettel）模板",
    body: String.raw`
const T = [
  "**🃏 Zettel · " + "{DATE}" + "**",
  "- 主题：",
  "- 来源：",
  "## 内容（用自己的话写）",
  "- ",
  "## 关联",
  "- 相关：[[ ]]",
  "- 反例：[[ ]]",
].join("\n");
def("zettel-new", "模板：Zettel 卡片", safe(async function () { await appendToday(T.replace("{DATE}", dateStr())); }));`,
  },

  // ----------------- UI 快捷 -----------------
  {
    id: "jump-yesterday",
    name: "跳转昨天",
    icon: "⬅️",
    category: "导航",
    tagline: "打开昨天的 journal 页",
    body: String.raw`
def("jump-yesterday", "跳转：昨天", safe(async function () { await jumpJournal(shiftDate(new Date(), -1)); }));`,
  },
  {
    id: "jump-tomorrow",
    name: "跳转明天",
    icon: "➡️",
    category: "导航",
    tagline: "打开明天的 journal 页",
    body: String.raw`
def("jump-tomorrow", "跳转：明天", safe(async function () { await jumpJournal(shiftDate(new Date(), 1)); }));`,
  },
  {
    id: "jump-last-week",
    name: "跳转上周今天",
    icon: "⏪",
    category: "导航",
    tagline: "打开 7 天前的 journal 页",
    body: String.raw`
def("jump-last-week", "跳转：7 天前", safe(async function () { await jumpJournal(shiftDate(new Date(), -7)); }));`,
  },
  {
    id: "random-journal",
    name: "随机回顾",
    icon: "🎰",
    category: "导航",
    tagline: "随机打开一篇过去的 journal",
    body: String.raw`
def("random-journal", "跳转：随机回顾", safe(async function () {
  const pages = ((await logseq.api.listPages()) || []).filter(function (p) { return p.journal_day; });
  if (!pages.length) { notify("没有 journal"); return; }
  const pick = rnd(pages);
  await logseq.api.openPage(pick.id);
  notify("已打开 " + pick.name);
}));`,
  },
  {
    id: "copy-page-md",
    name: "导出当前日记",
    icon: "📤",
    category: "导航",
    tagline: "把今日 journal 拼接成 Markdown 文本插入到自己页内",
    body: String.raw`
def("export-today", "导出：今日 journal 拼接为 Markdown 块", safe(async function () {
  const blocks = await journalBlocks();
  const body = blocks.map(function (b) { return "- " + String(b.content || ""); }).join("\n");
  await appendToday("**📤 导出快照**\n" + (body || "- *空*"));
}));`,
  },
];

export const OBSIDIAN_PACK: ObsidianStylePlugin[] = SPECS.map(build);
