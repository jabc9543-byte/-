import type { PluginManifest } from "../../stores/plugins";
import { DAILY_NOTES_MAIN_JS } from "./dailyNotes";
import { QUICK_SWITCHER_MAIN_JS } from "./quickSwitcher";

export interface BundledPlugin {
  manifest: PluginManifest;
  source: string;
}

export const BUNDLED_PLUGINS: BundledPlugin[] = [
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
    },
    source: QUICK_SWITCHER_MAIN_JS,
  },
];
