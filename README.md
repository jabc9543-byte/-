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
