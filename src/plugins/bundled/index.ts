import type { PluginManifest } from "../../stores/plugins";
import { DAILY_NOTES_MAIN_JS } from "./dailyNotes";
import { QUICK_SWITCHER_MAIN_JS } from "./quickSwitcher";
import { DATAVIEW_MAIN_JS } from "./dataview";
import { EXCALIDRAW_MAIN_JS } from "./excalidraw";
import { WEB_CLIPPER_MAIN_JS } from "./webClipper";
import { THEMES_MAIN_JS } from "./themes";
import { OBSIDIAN_PACK } from "./obsidianPack";
import { INSERT_HELPERS_MAIN_JS } from "./insertHelpers";

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
  ...OBSIDIAN_PACK,
];
