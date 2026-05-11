import type { MarketplaceEntry, MarketplaceListing } from "../stores/plugins";

/**
 * Built-in default marketplace.
 *
 * These entries are merged into the user-facing market listing on every
 * refresh so that a fresh install always shows at least the sample plugins
 * — no extra configuration required. Users can still add their own
 * registries through PluginManager → 市场。
 *
 * `download_url` must point to a zipped plugin bundle. We currently only
 * link to the in-repo sample; community plugins will be added here as the
 * marketplace grows.
 */
const ENTRIES: MarketplaceEntry[] = [
  {
    id: "com.example.hello-world",
    name: "Hello World",
    version: "0.1.0",
    description: "示例插件：注册命令和 /斜杠命令，演示插件 API 用法。",
    author: "全视维",
    homepage: "https://github.com/jabc9543-byte/-",
    tags: ["sample", "demo"],
    download_url:
      "https://github.com/jabc9543-byte/-/raw/main/plugins-sample/hello-world.zip",
    sha256: null,
    permissions: ["commands", "slashCommands", "readBlocks", "writeBlocks"],
  },
];

export const BUILTIN_MARKETPLACE: MarketplaceListing = {
  source: "builtin://default",
  entries: ENTRIES,
  fetched_at: new Date(0).toISOString(),
};
