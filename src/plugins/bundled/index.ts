import type { PluginManifest } from "../../stores/plugins";
import { DAILY_NOTES_MAIN_JS } from "./dailyNotes";
import { QUICK_SWITCHER_MAIN_JS } from "./quickSwitcher";
import { DATAVIEW_MAIN_JS } from "./dataview";
import { EXCALIDRAW_MAIN_JS } from "./excalidraw";
import { WEB_CLIPPER_MAIN_JS } from "./webClipper";
import { OBSIDIAN_PACK } from "./obsidianPack";

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
        "在块中输入斜杠命令可将查询结果插入当前块。斜杠：/dv-tasks、/dv-today、/dv-backlinks、/dv-tag、/dv-recent。命令：Dataview：弹窗查看未完成任务。",
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
        "查看 token、查看最近剪藏日志、手动剪藏 Markdown。斜杠：/clip-here、/clip-log。命令：Clipper：查看 X-Clip-Token；Clipper：查看最近剪藏记录；Clipper：快速剪藏到今日。",
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
  ...OBSIDIAN_PACK,
];
