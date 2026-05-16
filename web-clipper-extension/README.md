# 全视维 Web Clipper（浏览器扩展）

> 自研零依赖剪藏扩展，配合「全视维」桌面端使用，把任意网页 / 选区 / 链接一键写入今日 journal 或新建页面。

## 安装

### 方式一：从 GitHub Release 下载（推荐）

1. 到 [Releases](https://github.com/jabc9543-byte/-/releases) 下载 `quanshiwei-web-clipper-vX.Y.Z.zip`。
2. 解压到任意位置。
3. 在浏览器地址栏访问 `chrome://extensions`（Edge 是 `edge://extensions`），打开右上角「开发者模式」。
4. 点击「加载已解压的扩展程序」，选择解压目录。
5. 在桌面端「插件 → Clipper」面板复制 `X-Clip-Token`。
6. 点击浏览器工具栏的「全视维 Clipper」图标 → 展开 `⚙️ Settings`，粘贴 token → 保存。

### 方式二：从源码加载

直接选择本仓库的 `web-clipper-extension/` 目录加载即可。

## 使用

- **剪藏整页**：工具栏弹窗 → `剪藏整页`，自动 Readability 提取正文 + 标题，新建同名页面。
- **剪藏选区**：网页选中文本 → 工具栏弹窗 → `剪藏选区`，只保存选中内容到今日 journal。
- **右键菜单**：在网页 / 选区 / 链接上右键 → `剪藏到全视维`。
- **测试连接**：弹窗里点 `测试连接`，会请求 `/health`，成功即可剪藏。

## 协议

POST `http://127.0.0.1:33333/clip`

```http
Content-Type: application/json
X-Clip-Token: <桌面端 token>

{
  "title": "页面标题（留空则追加到今日 journal）",
  "url":   "https://example.com/article",
  "body":  "Markdown 正文（可包含 frontmatter）",
  "tags":  ["读书", "技术"],
  "mode":  "page" | "journal"
}
```

## 隐私

- token 与端点只保存在浏览器 `chrome.storage.sync`。
- 扩展只与 `http://127.0.0.1:33333` 通信，不向任何第三方服务器发送数据。
- 不上传浏览历史，不读取 cookie。

## 打包

仓库内执行：

```powershell
npm run pack:clipper
```

生成 `dist-extension/quanshiwei-web-clipper.zip`。

## License

MIT
