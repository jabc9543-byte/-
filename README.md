# Logseq-RS

使用 **Rust + Tauri 2 + React + TypeScript** 重构 [Logseq](https://github.com/logseq/logseq) 的初始脚手架，目标是长期保持与 Logseq 功能一致。本仓库是可运行的架构骨架（MVP），奠定了后续逐步逼近 Logseq 完整功能的基础。

> ⚠️ 说明：Logseq 本体超过 50 万行（ClojureScript 为主），功能对齐是多人年工程。本工程按**分层 + 存储抽象 + 纯 Rust 后端**的架构规划，后续可按模块（查询引擎、白板、PDF、插件系统、同步…）逐一实现。

## 架构概览

```
┌────────────────────────── UI (React + TS) ────────────────────────────┐
│  Sidebar · PageView · BlockTree · BlockRow · Backlinks · Gate         │
│                         Zustand stores                                │
└───────────────┬──────────────────────────────────────────────────────┘
                │ @tauri-apps/api invoke
┌───────────────┴────────── Tauri commands ────────────────────────────┐
│  graph · page · block · search                                       │
└───────────────┬──────────────────────────────────────────────────────┘
                │
┌───────────────┴────────── Rust core crate ───────────────────────────┐
│  state · graph · parser (md + [[link]]/#tag/((ref)))                 │
│  storage::Backend  ──┬── fs      (folder of *.md, Logseq-compatible) │
│                      └── sqlite  (single .db graph)                  │
│  model: Page / Block / GraphMeta / SearchHit                         │
└──────────────────────────────────────────────────────────────────────┘
```

两种存储后端实现了统一的 `Backend` trait，前端零改动即可切换。

## 已实现 (MVP)

- 打开 **Markdown 目录**（兼容 Logseq 布局：`pages/*.md`、`journals/yyyy_mm_dd.md`）
- 打开 **SQLite 图数据库**（schema v1，自动创建）
- 页面：列出 / 打开 / 新建 / 删除 / 重命名
- 块：新建 / 编辑 / 删除 / 缩进 / 反缩进（Tab / Shift+Tab / Enter / Backspace）
- Markdown 反向解析与序列化（保留 `- ` outline 格式）
- `[[双向链接]]`、`#tag`、`((block-ref))` 解析与反向链接（Backlinks）
- 全文搜索（LIKE / 内存扫描）

## 🛒 扩展广场 / 原生插件系统

应用内置一个仿 Obsidian 插件体系的「扩展广场」（顶部菜单 → 插件管理 → 扩展广场），所有扩展按分类卡片网格陈列，支持搜索、一键安装、版本检测。当前内置 **5 个原生扩展**，全部使用应用内原生数据 API（沙箱 Worker + 权限模型），无需任何第三方运行时：

| 扩展 | 分类 | 介绍 | 命令 / 斜杠 |
|---|---|---|---|
| 📊 **Dataview** | 查询与视图 | 把笔记当成数据库来查询。在块中输入斜杠命令即可把聚合结果作为 Markdown 列表插入当前块 | `/dv-tasks` 未完成任务 · `/dv-today` 今日 journal · `/dv-tag` 按标签 · `/dv-backlinks` 反链 · `/dv-recent` 最近页面 |
| 🎨 **Excalidraw** | 可视化 | 基于已集成的 tldraw 白板，把白板当作 Excalidraw 草图工具来用 | 命令「Excalidraw：新建快速草图」 · `/draw` 新建并插链 · `/draw-list` 插入白板列表 |
| 📎 **Web Clipper Pro** | 剪藏 | 与本地 HTTP 剪藏端点（`127.0.0.1` + X-Clip-Token）配合，提供应用内 token 查看、剪藏日志、快速手动剪藏 | 命令「Clipper：查看 X-Clip-Token / 查看最近剪藏 / 快速剪藏到今日」 · `/clip-here` · `/clip-log` |
| 📅 **Daily Notes 模板** | 生产力 | 一键为今日 journal 注入「任务 / 笔记 / 复盘」结构 | `/template` |
| ⚡ **Quick Switcher 增强** | 生产力 | 模糊匹配的页面快速跳转 | 命令「快速跳转：页面搜索」 · `/jump` |

**插件体系特性**

- **两种运行时**：原生（`pluginWorker.ts`）+ Obsidian 兼容 shim（`obsidianPluginWorker.ts`），Obsidian 单文件插件大多可直接装入
- **权限模型**：`commands` / `slashCommands` / `readBlocks` / `writeBlocks` / `http` / `sidebar`
- **沙箱化**：每个插件运行在独立 Web Worker，所有宿主调用走显式 RPC
- **宿主 API（节选）**：`listPages` / `getBlock` / `updateBlock` / `insertBlock` / `search` / `runQuery` / `openTasks` / `backlinks` / `blocksForDate` / `listWhiteboards` / `createWhiteboard` / `openWhiteboard` / `openPage` / `httpFetch` / `receiveClip` / `clipperLog` / `clipperToken`
- **第三方市场**：支持配置任意 HTTPS 资源库 URL（返回插件条目 JSON 即可被发现）
- **本地安装**：可从任意文件夹直接安装手写插件

## 规划扩展点（对应 Logseq 的模块）

| Logseq 模块 | 本工程扩展位置 |
|---|---|
| Datascript 查询引擎 | `src-tauri/src/query/` 新增；基于 `refs` 表做 datalog 子集 |
| Whiteboards | `src/components/Whiteboard/` + `tldraw` 或自研；后端持久化到 `whiteboards/` |
| Plugin SDK | 新增 `src-tauri/src/plugins/` + `wasm` runtime；前端 iframe/worker 注入 |
| Git / Sync | `src-tauri/src/sync/` 包裹 `git2` / 自研 CRDT |
| PDF 标注 | `src/components/Pdf/` + PDFium 绑定 |
| 文件监听 | `notify` 已在 deps 中；挂到 `FsBackend::rescan` |
| 主题 / i18n | `src/styles/` + `i18next` |

## 运行

前置：**Rust 1.75+**、**Node 18+**、Tauri 2 所需的系统依赖（见 <https://tauri.app/start/prerequisites/>）。

```powershell
# 安装依赖
cd logseq-rs
npm install

# 开发模式（会启动 Vite + Rust）
npm run tauri:dev

# 生产打包
npm run tauri:build
```

首次启动后：
1. 点击 "Open Markdown folder" 选择任意目录（可直接指向已有 Logseq graph）；
2. 或点击 "Open SQLite graph…" 选一个 `.db` 文件（不存在则会创建）。

## 目录结构

```
logseq-rs/
├─ src/                     前端 (React + TS)
│  ├─ api.ts                Tauri invoke 封装（类型安全）
│  ├─ types.ts              与 Rust model 对应的 TS 类型
│  ├─ stores/               Zustand: graph, page
│  ├─ components/           Sidebar / PageView / BlockTree / ...
│  └─ styles/global.css
└─ src-tauri/
   ├─ Cargo.toml
   ├─ tauri.conf.json
   ├─ capabilities/default.json
   └─ src/
      ├─ lib.rs             命令注册入口
      ├─ model.rs           Page / Block / GraphMeta
      ├─ parser.rs          Markdown ⇄ Block 树 + ref 提取
      ├─ graph.rs           Graph 包装器
      ├─ state.rs           AppState（当前图 + 最近记录）
      ├─ storage/
      │  ├─ mod.rs          Backend trait
      │  ├─ fs.rs           Markdown 文件夹后端
      │  └─ sqlite.rs       SQLite 后端（含 schema）
      └─ commands/
         ├─ graph.rs · page.rs · block.rs · search.rs
```

## 许可

参考 Logseq 本体采用 **AGPL-3.0**（由你决定是否延续）。
