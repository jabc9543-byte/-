import type { PluginManifest } from "../../stores/plugins";
import { DAILY_NOTES_MAIN_JS } from "./dailyNotes";
import { QUICK_SWITCHER_MAIN_JS } from "./quickSwitcher";
import { DATAVIEW_MAIN_JS } from "./dataview";
import { EXCALIDRAW_MAIN_JS } from "./excalidraw";
import { WEB_CLIPPER_MAIN_JS } from "./webClipper";
import { THEMES_MAIN_JS } from "./themes";
import { OBSIDIAN_PACK } from "./obsidianPack";
import { INSERT_HELPERS_MAIN_JS } from "./insertHelpers";
import { CALENDAR_MAIN_JS } from "./calendar";
import { QUICK_ADD_MAIN_JS } from "./quickAdd";
import { TEMPLATES_MAIN_JS } from "./templatesCore";
import { CLAUDIAN_MAIN_JS } from "./claudian";
import { GIT_MAIN_JS } from "./gitSync";

export interface BundledPlugin {
  manifest: PluginManifest;
  source: string;
}

export const BUNDLED_PLUGINS: BundledPlugin[] = [
  {
    manifest: {
      id: "com.logseqrs.dataview",
      name: "Dataview",
      version: "0.1.0",
      description:
        "在块中输入斜杠命令可将查询结果插入当前块。斜杠：/dv-tasks（未完成任务）、/dv-agenda（日程）、/dv-today、/dv-backlinks、/dv-tag、/dv-recent、/todo（把当前块变成 TODO 任务）。命令：Dataview：弹窗查看未完成任务。",
      author: "全视维 官方",
      entry: "main.js",
      permissions: ["commands", "slashCommands", "readBlocks", "writeBlocks"],
      kind: "native",
      category: "查询与视图",
      icon: "📊",
      tagline: "把笔记当成数据库来查询",
    },
    source: DATAVIEW_MAIN_JS,
  },
  {
    manifest: {
      id: "com.logseqrs.excalidraw",
      name: "Excalidraw",
      version: "0.1.0",
      description:
        "快速创建/查看/嵌入白板。斜杠：/draw、/draw-list。命令：Excalidraw：新建快速草图；Excalidraw：查看所有白板。",
      author: "全视维 官方",
      entry: "main.js",
      permissions: ["commands", "slashCommands", "readBlocks", "writeBlocks"],
      kind: "native",
      category: "可视化",
      icon: "🎨",
      tagline: "把白板当成你的 Excalidraw",
    },
    source: EXCALIDRAW_MAIN_JS,
  },
  {
    manifest: {
      id: "com.logseqrs.web-clipper",
      name: "Web Clipper Pro",
      version: "0.1.0",
      description:
        "全视维官方剪藏：本地 HTTP 接收端 + token + 自研浏览器扩展。斜杠：/clip-here、/clip-log。命令：Clipper：快速剪藏 / 高亮 / 查看 token / 查看接收端点 / 查看记录 / 详细使用步骤。配套扩展请到 GitHub Releases 下载 quanshiwei-web-clipper-vX.zip。",
      author: "全视维 官方",
      entry: "main.js",
      permissions: ["commands", "slashCommands", "readBlocks", "writeBlocks"],
      kind: "native",
      category: "剪藏",
      icon: "📎",
      tagline: "全视维官方剪藏管线，自带浏览器扩展",
    },
    source: WEB_CLIPPER_MAIN_JS,
  },
  {
    manifest: {
      id: "com.logseqrs.daily-notes-template",
      name: "Daily Notes 模板",
      version: "0.1.0",
      description:
        "插入「今日任务 / 笔记 / 复盘」模板。斜杠：/template。命令：插入今日模板到 journal。",
      author: "全视维 官方",
      entry: "main.js",
      permissions: ["commands", "slashCommands", "readBlocks", "writeBlocks"],
      kind: "native",
      category: "生产力",
      icon: "📅",
      tagline: "为今日 journal 自动生成结构",
    },
    source: DAILY_NOTES_MAIN_JS,
  },
  {
    manifest: {
      id: "com.logseqrs.quick-switcher",
      name: "Quick Switcher 增强",
      version: "0.1.0",
      description:
        "提供模糊匹配的页面快速跳转。斜杠：/jump。命令：快速跳转：页面搜索。",
      author: "全视维 官方",
      entry: "main.js",
      permissions: ["commands", "slashCommands", "readBlocks"],
      kind: "native",
      category: "生产力",
      icon: "⚡",
      tagline: "用模糊匹配快速跳到任何页面",
    },
    source: QUICK_SWITCHER_MAIN_JS,
  },
  {
    manifest: {
      id: "com.logseqrs.themes",
      name: "主题包",
      version: "0.1.0",
      description:
        "一键切换 10 套主题：跟随系统 / 浅色 / 深色 / Solarized Light / Solarized Dark / Nord / Paper / Forest / Midnight / Rose。命令：主题：跟随系统、主题：浅色 等。",
      author: "全视维 官方",
      entry: "main.js",
      permissions: ["commands"],
      kind: "native",
      category: "外观",
      icon: "🎨",
      tagline: "一键切换主题，立即生效",
    },
    source: THEMES_MAIN_JS,
  },
  {
    manifest: {
      id: "com.logseqrs.insert-helpers",
      name: "插入助手",
      version: "0.1.0",
      description:
        "向当前块快速插入：公式（块级 $$ 与行内 $）、网页链接、图片、代码块、表格、分割线。斜杠：/formula、/inline-formula、/link、/image-url、/code、/table-2x2、/hr。命令：插入助手：演示。",
      author: "全视维 官方",
      entry: "main.js",
      permissions: ["commands", "slashCommands", "readBlocks", "writeBlocks"],
      kind: "native",
      category: "生产力",
      icon: "➕",
      tagline: "一键插入公式、链接、图片、代码",
    },
    source: INSERT_HELPERS_MAIN_JS,
  },
  {
    manifest: {
      id: "com.logseqrs.calendar",
      name: "Calendar",
      version: "0.1.0",
      description:
        "弹窗显示本月日历，圈点标记写过 journal 的天，一眼看出断更。命令：Calendar：打开本月日历 / Calendar：跳到今天。斜杠：/calendar。输入数字跳到那一天，输入 < / > 翻月，t 回到今天。",
      author: "全视维 官方",
      entry: "main.js",
      permissions: ["commands", "slashCommands", "readBlocks", "writeBlocks"],
      kind: "native",
      category: "生产力",
      icon: "🗓️",
      tagline: "今天画一个点，不断更一眼看出",
    },
    source: CALENDAR_MAIN_JS,
  },
  {
    manifest: {
      id: "com.logseqrs.quick-add",
      name: "QuickAdd",
      version: "0.1.0",
      description:
        "三种快速动作：速记到 Inbox、新建论文笔记、追加到面试题库。命令：QuickAdd：速记 / QuickAdd：新建论文笔记 / QuickAdd：追加到面试题库。斜杠：/qa-capture、/qa-paper、/qa-append。",
      author: "全视维 官方",
      entry: "main.js",
      permissions: ["commands", "slashCommands", "readBlocks", "writeBlocks"],
      kind: "native",
      category: "生产力",
      icon: "⚡",
      tagline: "一键速记 / 模板化新建 / 闪电追加",
    },
    source: QUICK_ADD_MAIN_JS,
  },
  {
    manifest: {
      id: "com.logseqrs.templates",
      name: "Templates",
      version: "0.1.0",
      description:
        "把反复出现的结构存在「99-Templates」页，随时一键插入。命令：Insert template / Templates：管理模板。斜杠：/insert-template。变量：{{date}} {{time}} {{title}}。",
      author: "全视维 官方",
      entry: "main.js",
      permissions: ["commands", "slashCommands", "readBlocks", "writeBlocks"],
      kind: "native",
      category: "生产力",
      icon: "📄",
      tagline: "把重复劳动变成一键",
    },
    source: TEMPLATES_MAIN_JS,
  },
  {
    manifest: {
      id: "com.logseqrs.claudian",
      name: "Claudian",
      version: "0.1.0",
      description:
        "在全视维中直接调用 Claude AI。设置页「00-Claudian-Config」保存 API Key。斜杠：/ai-summary（总结）、/ai-explain（解释概念）、/ai-review（面试复盘）。命令：Claudian：配置 API Key / Claudian：使用步骤。",
      author: "全视维 官方",
      entry: "main.js",
      permissions: ["commands", "slashCommands", "readBlocks", "writeBlocks", "network"],
      kind: "native",
      category: "AI",
      icon: "🤖",
      tagline: "AI 总结 / 解释 / 复盘，一句 / 搞定",
    },
    source: CLAUDIAN_MAIN_JS,
  },
  {
    manifest: {
      id: "com.logseqrs.git-sync",
      name: "Git 同步",
      version: "0.1.0",
      description:
        "以 GitHub 仓库为中转站做多设备同步 + 版本恢复。命令：Git：配置仓库与 Token / Git：复制自动 commit&push 脚本 / Git：查看最近 commit / Git：完整使用步骤。斜杠：/git-status。",
      author: "全视维 官方",
      entry: "main.js",
      permissions: ["commands", "slashCommands", "readBlocks", "writeBlocks", "network"],
      kind: "native",
      category: "同步与备份",
      icon: "🔀",
      tagline: "一键 push 到 GitHub，多设备不丢备份",
    },
    source: GIT_MAIN_JS,
  },
  ...OBSIDIAN_PACK,
];
