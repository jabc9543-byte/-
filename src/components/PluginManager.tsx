import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { usePluginStore, type MarketplaceEntry } from "../stores/plugins";
import { BUNDLED_PLUGINS } from "../plugins/bundled";

interface ClipLogEntry {
  ts: number;
  method: string;
  path: string;
  status: number;
  title: string | null;
  note: string;
}

export function PluginManager({ onClose }: { onClose: () => void }) {
  const list = usePluginStore((s) => s.list);
  const commands = usePluginStore((s) => s.commands);
  const refresh = usePluginStore((s) => s.refresh);
  const install = usePluginStore((s) => s.install);
  const uninstall = usePluginStore((s) => s.uninstall);
  const setEnabled = usePluginStore((s) => s.setEnabled);
  const runCommand = usePluginStore((s) => s.runCommand);

  const registries = usePluginStore((s) => s.registries);
  const listings = usePluginStore((s) => s.listings);
  const marketLoading = usePluginStore((s) => s.marketLoading);
  const marketError = usePluginStore((s) => s.marketError);
  const addRegistry = usePluginStore((s) => s.addRegistry);
  const removeRegistry = usePluginStore((s) => s.removeRegistry);
  const refreshMarketplace = usePluginStore((s) => s.refreshMarketplace);
  const installFromMarketplace = usePluginStore((s) => s.installFromMarketplace);
  const installBundled = usePluginStore((s) => s.installBundled);

  const [tab, setTab] = useState<"installed" | "market" | "clipper">("installed");
  const [newUrl, setNewUrl] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    if (tab === "market") {
      refreshMarketplace().catch(() => {});
    }
  }, [tab, refreshMarketplace]);

  const onInstall = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || typeof selected !== "string") return;
    try {
      await install(selected);
    } catch (e) {
      alert(`安装失败：${String(e)}`);
    }
  };

  const onAddRegistry = async () => {
    const url = newUrl.trim();
    if (!url) return;
    try {
      await addRegistry(url);
      setNewUrl("");
    } catch (e) {
      alert(`添加资源库失败：${String(e)}`);
    }
  };

  const installedById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of list) m.set(p.manifest.id, p.manifest.version || "");
    return m;
  }, [list]);

  const flatEntries = useMemo(() => {
    const rows: { entry: MarketplaceEntry; source: string }[] = [];
    for (const l of listings) {
      for (const e of l.entries) rows.push({ entry: e, source: l.source });
    }
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(({ entry }) =>
      `${entry.name} ${entry.id} ${entry.description} ${entry.author} ${(entry.tags ?? []).join(" ")}`
        .toLowerCase()
        .includes(q),
    );
  }, [listings, filter]);

  const onInstallMarket = async (entry: MarketplaceEntry) => {
    setBusy(entry.id);
    try {
      await installFromMarketplace(entry);
    } catch (e) {
      alert(`安装失败：${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="plugin-manager">
      <div className="plugin-manager-header">
        <strong>插件</strong>
        <button className="pdf-close" onClick={onClose}>×</button>
      </div>
      <div className="plugin-tabs">
        <button
          className={tab === "installed" ? "active" : ""}
          onClick={() => setTab("installed")}
        >
          已安装（{list.length}）
        </button>
        <button
          className={tab === "market" ? "active" : ""}
          onClick={() => setTab("market")}
        >
          插件市场
        </button>
        <button
          className={tab === "clipper" ? "active" : ""}
          onClick={() => setTab("clipper")}
        >
          Web Clipper
        </button>
      </div>

      {tab === "installed" && (
        <>
          <div className="plugin-manager-actions">
            <button onClick={onInstall}>从文件夹安装…</button>
            <button onClick={() => refresh()}>重载</button>
          </div>
          <ul className="plugin-list">
            {list.length === 0 && (
              <li className="plugin-empty">
                尚未安装插件。选择包含 <code>plugin.json</code> 的文件夹（原生插件），
                或包含 <code>manifest.json</code> + <code>main.js</code> 的 Obsidian 插件文件夹
                （best-effort 兼容）。
              </li>
            )}
            {list.map((p) => {
              const pluginCommands = commands.filter((c) => c.pluginId === p.manifest.id);
              return (
                <li key={p.manifest.id} className={`plugin-card${p.enabled ? " enabled" : ""}`}>
                  <div className="plugin-title">
                    <span className="plugin-name">{p.manifest.name}</span>
                    <span className="plugin-version">v{p.manifest.version || "?"}</span>
                    {p.manifest.kind === "obsidian" && (
                      <span className="plugin-market-badge update" title="Obsidian 插件兼容模式（best-effort）">
                        Obsidian
                      </span>
                    )}
                  </div>
                  {p.manifest.description && (
                    <p className="plugin-desc">{p.manifest.description}</p>
                  )}
                  <div className="plugin-perms">
                    {p.manifest.permissions.map((pm) => (
                      <span key={pm} className="plugin-perm">{pm}</span>
                    ))}
                  </div>
                  {pluginCommands.length > 0 && (
                    <div className="plugin-commands">
                      {pluginCommands.map((c) => (
                        <button
                          key={c.id}
                          className="plugin-command"
                          onClick={() => runCommand(p.manifest.id, c.id)}
                        >
                          ▸ {c.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="plugin-actions">
                    <label className="plugin-toggle">
                      <input
                        type="checkbox"
                        checked={p.enabled}
                        onChange={(e) => setEnabled(p.manifest.id, e.target.checked)}
                      />
                      启用
                    </label>
                    <button
                      className="plugin-uninstall"
                      onClick={async () => {
                        if (confirm(`卸载 ${p.manifest.name}？`)) {
                          await uninstall(p.manifest.id);
                        }
                      }}
                    >
                      卸载
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {tab === "market" && (
        <div className="plugin-marketplace">
          <div className="plugin-recommended">
            <h4>✨ 推荐插件（内置，一键安装）</h4>
            <ul className="plugin-market-list">
              {BUNDLED_PLUGINS.map(({ manifest, source }) => {
                const installedVer = installedById.get(manifest.id);
                const isInstalled = installedVer !== undefined;
                const hasUpdate = isInstalled && installedVer !== manifest.version;
                const disabled = busy === manifest.id || (isInstalled && !hasUpdate);
                return (
                  <li key={manifest.id} className="plugin-market-item">
                    <div className="plugin-title">
                      <span className="plugin-name">{manifest.name}</span>
                      <span className="plugin-version">v{manifest.version}</span>
                      {isInstalled && !hasUpdate && (
                        <span className="plugin-market-badge installed">已安装</span>
                      )}
                      {hasUpdate && (
                        <span className="plugin-market-badge update">
                          更新（{installedVer} → {manifest.version}）
                        </span>
                      )}
                    </div>
                    <p className="plugin-desc">{manifest.description}</p>
                    <div className="plugin-perms">
                      {manifest.permissions.map((pm) => (
                        <span key={pm} className="plugin-perm">{pm}</span>
                      ))}
                    </div>
                    <div className="plugin-actions">
                      <button
                        className="plugin-market-install"
                        disabled={disabled}
                        onClick={async () => {
                          setBusy(manifest.id);
                          try {
                            await installBundled(manifest, source);
                          } catch (e) {
                            alert(`安装失败：${String(e)}`);
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        {busy === manifest.id
                          ? "安装中…"
                          : hasUpdate
                            ? "更新"
                            : isInstalled
                              ? "已安装"
                              : "安装"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="plugin-registry-controls">
            <input
              className="plugin-registry-input"
              type="url"
              placeholder="https://example.com/plugins.json"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onAddRegistry();
              }}
            />
            <button onClick={onAddRegistry} disabled={!newUrl.trim()}>
              添加资源库
            </button>
            <button onClick={() => refreshMarketplace()} disabled={marketLoading}>
              {marketLoading ? "刷新中…" : "刷新"}
            </button>
          </div>

          {registries.length > 0 && (
            <ul className="plugin-registry-list">
              {registries.map((url) => (
                <li key={url} className="plugin-registry-row">
                  <span className="plugin-registry-url" title={url}>{url}</span>
                  <button
                    className="plugin-registry-remove"
                    onClick={() => removeRegistry(url)}
                    title="移除"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {registries.length === 0 && (
            <div className="plugin-empty">
              添加一个插件市场 URL 以发现插件。URL 应返回插件条目的
              JSON 数组（或 <code>{"{ plugins: [...] }"}</code>）。
            </div>
          )}

          {marketError && <div className="plugin-market-error">{marketError}</div>}

          {registries.length > 0 && (
            <input
              className="plugin-market-filter"
              type="search"
              placeholder="筛选插件…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}

          <ul className="plugin-market-list">
            {flatEntries.length === 0 && registries.length > 0 && !marketLoading && (
              <li className="plugin-empty">无匹配的插件。</li>
            )}
            {flatEntries.map(({ entry, source }) => {
              const installedVer = installedById.get(entry.id);
              const isInstalled = installedVer !== undefined;
              const hasUpdate =
                isInstalled && entry.version !== "" && installedVer !== entry.version;
              const disabled = busy === entry.id || (isInstalled && !hasUpdate);
              return (
                <li key={`${source}::${entry.id}`} className="plugin-market-item">
                  <div className="plugin-title">
                    <span className="plugin-name">{entry.name}</span>
                    <span className="plugin-version">v{entry.version || "?"}</span>
                    {isInstalled && !hasUpdate && (
                      <span className="plugin-market-badge installed">已安装</span>
                    )}
                    {hasUpdate && (
                      <span className="plugin-market-badge update">
                        更新（{installedVer} → {entry.version}）
                      </span>
                    )}
                  </div>
                  {entry.description && (
                    <p className="plugin-desc">{entry.description}</p>
                  )}
                  <div className="plugin-market-meta">
                    {entry.author && <span>作者：{entry.author}</span>}
                    {entry.tags && entry.tags.length > 0 && (
                      <span className="plugin-market-tags">
                        {entry.tags.map((t) => (
                          <span key={t} className="plugin-perm">{t}</span>
                        ))}
                      </span>
                    )}
                  </div>
                  <div className="plugin-perms">
                    {entry.permissions.map((pm) => (
                      <span key={pm} className="plugin-perm">{pm}</span>
                    ))}
                  </div>
                  <div className="plugin-actions">
                    <button
                      className="plugin-market-install"
                      disabled={disabled}
                      onClick={() => onInstallMarket(entry)}
                    >
                      {busy === entry.id
                        ? "安装中…"
                        : hasUpdate
                          ? "更新"
                          : isInstalled
                            ? "已安装"
                            : "安装"}
                    </button>
                    {entry.homepage && (
                      <a
                        href={entry.homepage}
                        target="_blank"
                        rel="noreferrer"
                        className="plugin-market-link"
                      >
                        主页 ↗
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {tab === "clipper" && <ClipperPanel />}
    </div>
  );
}

function ClipperPanel() {
  const [copied, setCopied] = useState<string | null>(null);
  const [token, setToken] = useState<string>("");
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [log, setLog] = useState<ClipLogEntry[]>([]);
  const [logError, setLogError] = useState<string | null>(null);
  const exampleUrl =
    "quanshiwei://clip?title=Example&url=https%3A%2F%2Fexample.com&body=Hello%20from%20clipper&tags=demo,clip";
  const obsidianTemplate =
    "quanshiwei://clip?title={{title}}&url={{url}}&body={{content}}&tags={{tags}}";
  const httpEndpoint = "http://127.0.0.1:33333/clip";
  useEffect(() => {
    let mounted = true;
    invoke<string>("get_clip_token")
      .then((t) => {
        if (mounted) setToken(t);
      })
      .catch((e) => {
        if (mounted) setTokenError(String(e));
      });
    return () => {
      mounted = false;
    };
  }, []);

  const refreshLog = async () => {
    try {
      const entries = await invoke<ClipLogEntry[]>("clip_log");
      setLog(entries.slice().reverse());
      setLogError(null);
    } catch (e) {
      setLogError(String(e));
    }
  };
  useEffect(() => {
    refreshLog();
    const t = window.setInterval(refreshLog, 4000);
    return () => window.clearInterval(t);
  }, []);
  const clearLog = async () => {
    try {
      await invoke("clear_clip_log");
      setLog([]);
    } catch (e) {
      setLogError(String(e));
    }
  };
  const tokenDisplay = token ? (showToken ? token : "•".repeat(Math.min(token.length, 32))) : "(loading…)";
  const tokenForSamples = token || "<paste-token-here>";
  const curlSample =
    "curl -X POST http://127.0.0.1:33333/clip \\\n" +
    `  -H 'x-clip-token: ${tokenForSamples}' \\\n` +
    "  -H 'content-type: application/json' \\\n" +
    "  -d '{\"title\":\"Example\",\"url\":\"https://example.com\",\"body\":\"Hello from clipper\",\"tags\":[\"demo\"]}'";
  const fetchSample =
    "// In a browser-extension content script or background worker:\n" +
    "await fetch(\"http://127.0.0.1:33333/clip\", {\n" +
    "  method: \"POST\",\n" +
    "  headers: {\n" +
    "    \"content-type\": \"application/json\",\n" +
    `    \"x-clip-token\": ${JSON.stringify(tokenForSamples)}\n` +
    "  },\n" +
    "  body: JSON.stringify({\n" +
    "    title: document.title,\n" +
    "    url: location.href,\n" +
    "    body: selectedMarkdown,\n" +
    "    tags: [\"clipped\"]\n" +
    "  })\n" +
    "});";
  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };
  const rotate = async () => {
    if (rotating) return;
    if (!window.confirm("旋转令牌会让现有浏览器扩展配置立刻失效，确认继续？")) return;
    setRotating(true);
    try {
      const fresh = await invoke<string>("rotate_clip_token");
      setToken(fresh);
      setShowToken(true);
    } catch (e) {
      setTokenError(String(e));
    } finally {
      setRotating(false);
    }
  };
  return (
    <div className="plugin-clipper">
      <p>
        全视维内置 <strong>Web Clipper 接收器</strong>，可以接收来自浏览器扩展
        （如 <em>Obsidian Web Clipper</em>）的剪藏，写入今日 journal 或新建页面。
      </p>
      <p>
        支持两条接收通道：<strong>本地 HTTP 端口</strong>（推荐，免协议提示）
        和 <strong>URL Scheme</strong>（兼容现有 Obsidian Web Clipper 模板）。
      </p>

      <h4>1. 本地 HTTP 端口（推荐）</h4>
      <p>
        应用启动后会在 <code>{httpEndpoint}</code> 监听 <code>POST</code> 请求，
        仅绑定 <code>127.0.0.1</code>，局域网内其它设备无法访问。
      </p>
      <div className="plugin-clipper-actions">
        <code className="plugin-clipper-example">{httpEndpoint}</code>
        <button onClick={() => copy(httpEndpoint, "endpoint")}>
          {copied === "endpoint" ? "已复制" : "复制 URL"}
        </button>
      </div>

      <h5>访问令牌</h5>
      <p>
        每次 <code>POST /clip</code> 必须携带 <code>X-Clip-Token</code> 请求头
        （或 <code>?token=...</code> 查询参数）。同机器上的任何进程都能访问
        <code>127.0.0.1</code>，所以令牌是唯一的访问控制。
      </p>
      {tokenError && (
        <p className="plugin-clipper-hint" style={{ color: "#c00" }}>
          读取令牌失败：{tokenError}
        </p>
      )}
      <div className="plugin-clipper-actions">
        <code className="plugin-clipper-example" style={{ fontFamily: "monospace", letterSpacing: "0.05em" }}>
          {tokenDisplay}
        </code>
        <button onClick={() => setShowToken((v) => !v)} disabled={!token}>
          {showToken ? "隐藏" : "显示"}
        </button>
        <button onClick={() => token && copy(token, "token")} disabled={!token}>
          {copied === "token" ? "已复制" : "复制"}
        </button>
        <button onClick={rotate} disabled={rotating}>
          {rotating ? "正在旋转…" : "重新生成"}
        </button>
      </div>

      <p>请求体（JSON）：</p>
      <pre className="plugin-clipper-code">
{`{
  "title":  "<标题>",
  "url":    "<原文 URL>",
  "body":   "<Markdown 正文>",
  "tags":   ["tag1", "tag2"],
  "mode":   "page" | "journal"   // 可选，缺省同 URL scheme 规则
}`}
      </pre>
      <p>命令行测试：</p>
      <div className="plugin-clipper-actions">
        <pre className="plugin-clipper-code plugin-clipper-snippet">{curlSample}</pre>
        <button onClick={() => copy(curlSample, "curl")}>
          {copied === "curl" ? "已复制" : "复制"}
        </button>
      </div>
      <p>浏览器扩展中调用：</p>
      <div className="plugin-clipper-actions">
        <pre className="plugin-clipper-code plugin-clipper-snippet">{fetchSample}</pre>
        <button onClick={() => copy(fetchSample, "fetch")}>
          {copied === "fetch" ? "已复制" : "复制"}
        </button>
      </div>
      <p className="plugin-clipper-hint">
        健康检查（不需要令牌）：<code>GET http://127.0.0.1:33333/health</code> 返回
        <code>{` {"ok":true,"service":"quanshiwei-clipper"} `}</code>。
      </p>

      <h4>2. URL Scheme（备选）</h4>
      <p>系统已注册 <code>quanshiwei://</code>（兼容 <code>lsrs://</code>）协议：</p>
      <pre className="plugin-clipper-code">
        {`quanshiwei://clip?title=<标题>&url=<原文 URL>&body=<Markdown 正文>&tags=<标签,逗号分隔>&mode=<page|journal>`}
      </pre>
      <p className="plugin-clipper-hint">
        所有参数都需 URL 编码。省略 <code>mode</code> 时：有标题→新建页面；无标题→
        追加到今日 journal。Scheme 通道适合"用户点击链接"场景；自动化场景请优先
        使用 HTTP 端口。
      </p>
      <div className="plugin-clipper-actions">
        <code className="plugin-clipper-example">{exampleUrl}</code>
        <button onClick={() => copy(exampleUrl, "example")}>
          {copied === "example" ? "已复制" : "复制"}
        </button>
      </div>

      <h4>3. Obsidian Web Clipper 配置</h4>
      <ol className="plugin-clipper-steps">
        <li>在浏览器安装 <strong>Obsidian Web Clipper</strong>。</li>
        <li>新建一个 Template，将 Behavior 设为 <code>Open in browser</code>（或自定义 URL）。</li>
        <li>把 URL 模板设置为：</li>
      </ol>
      <div className="plugin-clipper-actions">
        <code className="plugin-clipper-example">{obsidianTemplate}</code>
        <button onClick={() => copy(obsidianTemplate, "template")}>
          {copied === "template" ? "已复制" : "复制"}
        </button>
      </div>
      <p className="plugin-clipper-hint">
        如果模板里使用 Markdown 转 Frontmatter 字段（如 <code>{"{{ tags|join:\",\" }}"}</code>），
        请确保最终是逗号分隔的字符串。
      </p>

      <h4>4. 最近请求</h4>
      <p className="plugin-clipper-hint">
        仅保存在内存中（应用重启即清空），最多 50 条。展示请求方法、路径、HTTP
        状态码与（若有）标题，便于诊断 <code>401</code> / <code>400</code> 错误。
      </p>
      {logError && (
        <p className="plugin-clipper-hint" style={{ color: "#c00" }}>
          读取日志失败：{logError}
        </p>
      )}
      <div className="plugin-clipper-actions">
        <button onClick={refreshLog}>刷新</button>
        <button onClick={clearLog} disabled={log.length === 0}>清空</button>
        <span className="plugin-clipper-hint">共 {log.length} 条</span>
      </div>
      {log.length === 0 ? (
        <p className="plugin-clipper-hint">暂无请求记录。</p>
      ) : (
        <pre className="plugin-clipper-code" style={{ maxHeight: 240, overflow: "auto" }}>
{log
  .map((e) => {
    const t = new Date(e.ts).toLocaleTimeString();
    const status =
      e.status >= 500 ? `${e.status}!` :
      e.status >= 400 ? `${e.status}?` :
      `${e.status} `;
    const title = e.title ? ` — ${e.title.slice(0, 60)}` : "";
    return `${t}  ${status}  ${e.method.padEnd(6)} ${e.path.padEnd(20)} ${e.note}${title}`;
  })
  .join("\n")}
        </pre>
      )}

      <h4>5. 安全说明</h4>
      <ul className="plugin-clipper-notes">
        <li>HTTP 端口仅绑定 <code>127.0.0.1</code>，外部主机无法访问。</li>
        <li><code>POST /clip</code> 必须带匹配的 <code>X-Clip-Token</code>，缺失或错误返回 401。</li>
        <li>令牌存放在 <code>app_local_data_dir/clip-token.txt</code>，由 OS 文件权限保护。</li>
        <li>单次请求体上限 4 MiB，读取超时 15 秒。</li>
        <li>剪藏内容以纯文本写入，<strong>不会执行</strong>任何脚本。</li>
        <li>仅 <code>quanshiwei</code> / <code>lsrs</code> 两个 scheme 会被处理。</li>
        <li>桌面端首次使用 Scheme 通道需在系统中允许应用注册协议。</li>
      </ul>
    </div>
  );
}

export function PluginNotifications() {
  const notifications = usePluginStore((s) => s.notifications);
  const dismiss = usePluginStore((s) => s.dismissNotification);
  useEffect(() => {
    const timers = notifications.map((n) =>
      window.setTimeout(() => dismiss(n.id), 4000),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [notifications, dismiss]);
  if (notifications.length === 0) return null;
  return (
    <div className="plugin-toasts">
      {notifications.map((n) => (
        <div key={n.id} className="plugin-toast" onClick={() => dismiss(n.id)}>
          <span className="plugin-toast-from">{n.pluginId}</span>
          <span className="plugin-toast-msg">{n.message}</span>
        </div>
      ))}
    </div>
  );
}
