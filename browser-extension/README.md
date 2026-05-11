# 全视维 Clipper (浏览器扩展)

最小化的 Manifest V3 浏览器扩展，用于把当前网页或选中文字一键剪藏到本机运行的 **全视维（Quanshiwei）** 桌面端。

桌面端需开启 **HTTP Clipper 插件**（监听 `127.0.0.1:33333`），并在桌面端 ▸ *插件* ▸ *HTTP Clipper* 里复制访问令牌。

## 功能

- 浏览器右上角点击扩展图标 ▸ 弹窗：
  - 粘贴/保存访问令牌
  - 测试连接（GET `/health`）
  - 一键剪藏当前页面 / 仅剪藏所选文字
- 在页面或文字选区上右键 ▸ *剪藏到全视维* 直接发送
- 桌面通知反馈成功/失败

## 安装（开发者模式）

1. 打开 Chrome / Edge（基于 Chromium 的浏览器）的扩展页：
   - Chrome: `chrome://extensions`
   - Edge:   `edge://extensions`
2. 打开右上角的 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择本文件所在目录 `browser-extension/`
4. 在桌面端 ▸ *插件* ▸ *HTTP Clipper* 复制访问令牌，粘贴到扩展弹窗里 ▸ *保存*
5. 在任意页面点 *测试连接* ▸ 看到 *连接成功 (HTTP 200)* 即配置完成

## 数据流

```
浏览器扩展 ──POST http://127.0.0.1:33333/clip──> 全视维桌面端
            X-Clip-Token: <你的令牌>
            { title, url, body, tags, mode }
```

不会发送任何数据到第三方。所有请求都走环回地址。

## 字段

| 字段 | 来源 |
|------|------|
| `title` | `document.title` |
| `url`   | `location.href` |
| `body`  | 选中文字 / 整页 `innerText`（截至 200 KB） |
| `tags`  | `["clipped"]` 或 `["selection"]` |
| `mode`  | `"page"` 或 `"journal"` |

## 排错

- *连接失败 / Failed to fetch*：确认桌面端已启动；用桌面端 *最近请求* 面板检查
- *HTTP 401*：令牌错误或令牌已轮换，重新粘贴
- *HTTP 400*：请求体非 JSON，通常说明扩展自身出问题（请提 issue）
- 通知不弹：浏览器系统通知被禁用 — 弹窗里的状态条仍有效

## 文件清单

- `manifest.json` — MV3 清单
- `background.js` — Service worker，处理右键菜单与剪藏请求
- `popup.html` / `popup.js` — 点击图标弹出的小面板
- `options.html` — 也复用 `popup.js`，浏览器扩展的“选项”入口
- `icon.png` — 占位图标（自行替换为更精致的 16/48/128 PNG 即可）
