import type { PluginManifest } from "../../stores/plugins";
import { DAILY_NOTES_MAIN_JS } from "./dailyNotes";
import { QUICK_SWITCHER_MAIN_JS } from "./quickSwitcher";
import { DATAVIEW_MAIN_JS } from "./dataview";
import { EXCALIDRAW_MAIN_JS } from "./excalidraw";
import { WEB_CLIPPER_MAIN_JS } from "./webClipper";

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
        "在块中输入 /dv-tasks、/dv-today、/dv-tag、/dv-backlinks、/dv-recent 即可把查询结果作为 Markdown 列表插入当前块。仿 Obsidian Dataview 的核心聚合视图，使用原生数据 API 实现。",
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
        "原生白板能力的快捷封装：命令面板执行「Excalidraw：新建快速草图」即可在 tldraw 白板中开画，或在块中使用 /draw、/draw-list。",
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
        "把已存在的本地 HTTP Clipper 端点封装成应用内命令：查看 token、查看最近剪藏日志、快速手动剪藏一段 Markdown 到今日 journal 或新建页面。",
      author: "全视维 官方",
      entry: "main.js",
      permissions: ["commands", "slashCommands", "readBlocks", "writeBlocks"],
      kind: "native",
      category: "剪藏",
      icon: "📎",
      tagline: "剪藏一切，留在自己的知识库",
    },
    source: WEB_CLIPPER_MAIN_JS,
  },
  {
    manifest: {
      id: "com.logseqrs.daily-notes-template",
      name: "Daily Notes 模板",
      version: "0.1.0",
      description:
        "在当前块输入 /template 插入「今日任务 / 笔记 / 复盘」结构，或一键写入今日 journal。",
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
        "提供模糊匹配的页面快速跳转。命令面板中执行「快速跳转：页面搜索」即可使用。",
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
];
