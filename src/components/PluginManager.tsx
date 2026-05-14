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
  const [plazaCategory, setPlazaCategory] = useState<string>("全部");
  const [plazaQuery, setPlazaQuery] = useState("");
  const [detailFor, setDetailFor] = useState<string | null>(null);

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
          扩展广场
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
                      className="plugin-detail-btn"
                      onClick={() => setDetailFor(p.manifest.id)}
                    >
                      查看详情
                    </button>
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
          <div className="plugin-plaza">
            <div className="plugin-plaza-head">
              <div>
                <h4>🛒 扩展广场</h4>
                <p className="plugin-plaza-sub">
                  内置原生扩展，一键安装即用 · 仿 Obsidian 插件体系打造
                </p>
              </div>
              <input
                className="plugin-plaza-search"
                type="search"
                placeholder="搜索扩展…"
                value={plazaQuery}
                onChange={(e) => setPlazaQuery(e.target.value)}
              />
            </div>
            {(() => {
              const allCats = Array.from(
                new Set(BUNDLED_PLUGINS.map((b) => b.manifest.category || "其他")),
              );
              const cats = ["全部", ...allCats];
              const q = plazaQuery.trim().toLowerCase();
              const filtered = BUNDLED_PLUGINS.filter(({ manifest }) => {
                const cat = manifest.category || "其他";
                if (plazaCategory !== "全部" && cat !== plazaCategory) return false;
                if (!q) return true;
                return `${manifest.name} ${manifest.description} ${manifest.tagline ?? ""} ${cat}`
                  .toLowerCase()
                  .includes(q);
              });
              return (
                <>
                  <div className="plugin-plaza-chips">
                    {cats.map((c) => (
                      <button
                        key={c}
                        className={
                          "plugin-plaza-chip" +
                          (plazaCategory === c ? " active" : "")
                        }
                        onClick={() => setPlazaCategory(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <div className="plugin-plaza-grid">
                    {filtered.length === 0 && (
                      <div className="plugin-empty">没有匹配的扩展。</div>
                    )}
                    {filtered.map(({ manifest, source }) => {
                      const installedVer = installedById.get(manifest.id);
                      const isInstalled = installedVer !== undefined;
                      const hasUpdate =
                        isInstalled && installedVer !== manifest.version;
                      const disabled =
                        busy === manifest.id || (isInstalled && !hasUpdate);
                      return (
                        <div key={manifest.id} className="plugin-plaza-card">
                          <div className="plugin-plaza-card-top">
                            <div className="plugin-plaza-icon">
                              {manifest.icon ?? "🧩"}
                            </div>
                            <div className="plugin-plaza-meta">
                              <div className="plugin-plaza-title">
                                {manifest.name}
                                <span className="plugin-version">
                                  v{manifest.version}
                                </span>
                                {isInstalled && !hasUpdate && (
                                  <span className="plugin-market-badge installed">
                                    已安装
                                  </span>
                                )}
                                {hasUpdate && (
                                  <span className="plugin-market-badge update">
                                    可更新
                                  </span>
                                )}
                              </div>
                              {manifest.tagline && (
                                <div className="plugin-plaza-tagline">
                                  {manifest.tagline}
                                </div>
                              )}
                              <div className="plugin-plaza-cat">
                                {manifest.category || "其他"} · {manifest.author}
                              </div>
                            </div>
                          </div>
                          <p className="plugin-plaza-desc">
                            {manifest.description}
                          </p>
                          <div className="plugin-perms">
                            {manifest.permissions.map((pm) => (
                              <span key={pm} className="plugin-perm">
                                {pm}
                              </span>
                            ))}
                          </div>
                          <div className="plugin-plaza-actions">
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
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
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
      {detailFor && (
        <PluginDetailModal
          pluginId={detailFor}
          onClose={() => setDetailFor(null)}
        />
      )}
    </div>
  );
}

function PluginDetailModal({
  pluginId,
  onClose,
}: {
  pluginId: string;
  onClose: () => void;
}) {
  const list = usePluginStore((s) => s.list);
  const commands = usePluginStore((s) => s.commands);
  const slashCommands = usePluginStore((s) => s.slashCommands);
  const runCommand = usePluginStore((s) => s.runCommand);
  const plugin = list.find((p) => p.manifest.id === pluginId);
  if (!plugin) return null;
  const m = plugin.manifest;
  const cmds = commands.filter((c) => c.pluginId === pluginId);
  const slashes = slashCommands.filter((c) => c.pluginId === pluginId);

  const guides: Record<string, string[]> = {
    "com.logseqrs.web-clipper": [
      "1) 启用本插件后，点击「插件 → Web Clipper」选项卡查看 token 与端点。",
      "2) 在浏览器安装 Obsidian Web Clipper 扩展，把 endpoint 设为 http://127.0.0.1:33333/clip ，把 Authorization 改为 Bearer <token>。",
      "3) 任意网页右键「Clip to Logseq-rs」，剪藏内容会立即写入今日 journal。",
      "4) 想验证管道是否通畅，可点击下面的「一键测试发送」。",
    ],
    "com.logseqrs.insert-helpers": [
      "1) 把光标放在任意块上。",
      "2) 输入 /formula、/inline-formula、/link、/image-url、/code、/table-2x2、/hr 之一。",
      "3) 按提示输入即可。也可以点击下方「运行示例」直接在今日 journal 中插入示例。",
    ],
    "com.logseqrs.weather-stamp": [
      "1) 启用并运行命令「天气：写入今日天气」即可在今日 journal 追加一行天气。",
      "2) 「天气：按城市写入」会弹窗让你输入城市拼音。",
      "3) 插件通过 Tauri 原生 HTTP 调用 wttr.in ，不受浏览器 CORS 限制。",
    ],
  };
  const guide = guides[m.id];

  return (
    <div className="plugin-detail-modal-backdrop" onClick={onClose}>
      <div className="plugin-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="plugin-detail-head">
          <div>
            <h3>
              {m.icon ? <span style={{ marginRight: 6 }}>{m.icon}</span> : null}
              {m.name}
              <span className="plugin-version" style={{ marginLeft: 8 }}>
                v{m.version || "?"}
              </span>
            </h3>
            {m.tagline && <p className="plugin-detail-tagline">{m.tagline}</p>}
          </div>
          <button className="pdf-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="plugin-detail-body">
          {m.description && (
            <section>
              <h4>简介</h4>
              <p className="plugin-desc">{m.description}</p>
            </section>
          )}
          {guide && (
            <section>
              <h4>使用流程</h4>
              <ol className="plugin-detail-guide">
                {guide.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ol>
            </section>
          )}
          <section>
            <h4>权限</h4>
            <div className="plugin-perms">
              {m.permissions.map((pm) => (
                <span key={pm} className="plugin-perm">
                  {pm}
                </span>
              ))}
            </div>
          </section>
          {cmds.length > 0 && (
            <section>
              <h4>命令（{cmds.length}）</h4>
              <ul className="plugin-detail-cmd-list">
                {cmds.map((c) => (
                  <li key={c.id}>
                    <button
                      className="plugin-command"
                      onClick={() => runCommand(pluginId, c.id)}
                    >
                      ▸ {c.label}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {slashes.length > 0 && (
            <section>
              <h4>斜杠命令（{slashes.length}）</h4>
              <ul className="plugin-detail-slash-list">
                {slashes.map((s) => (
                  <li key={s.trigger}>
                    <code>{s.trigger}</code>
                    <span style={{ marginLeft: 8 }}>{s.label}</span>
                  </li>
                ))}
              </ul>
              <p className="plugin-detail-hint">
                在编辑器中输入对应斜杠即可调用。
              </p>
            </section>
          )}
          {cmds.length > 0 && (
            <section>
              <h4>示例演示</h4>
              <button
                className="plugin-detail-demo"
                onClick={() => runCommand(pluginId, cmds[0].id)}
              >
                运行示例：{cmds[0].label}
              </button>
            </section>
          )}
          <section className="plugin-detail-meta">
            <div>
              <strong>作者</strong>：{m.author || "—"}
            </div>
            <div>
              <strong>分类</strong>：{m.category || "—"}
            </div>
            <div>
              <strong>类型</strong>：{m.kind === "obsidian" ? "Obsidian 兼容" : "原生"}
            </div>
          </section>
        </div>
      </div>
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
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
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
      <p>一键测试：直接通过应用内 HTTP 客户端向本地端点发送一条示例剪藏。</p>
      <div className="plugin-clipper-actions">
        <button
          disabled={testing || !token}
          onClick={async () => {
            if (!token) return;
            setTesting(true);
            setTestStatus(null);
            try {
              const res = await invoke<{ status: number; body: string }>(
                "plugin_http_fetch",
                {
                  url: httpEndpoint,
                  init: {
                    method: "POST",
                    headers: {
                      "content-type": "application/json",
                      "x-clip-token": token,
                    },
                    body: JSON.stringify({
                      title: "Clipper 测试 " + new Date().toLocaleTimeString(),
                      url: "https://example.com",
                      body: "这是一条由「一键测试发送」按钮触发的剪藏。",
                      tags: ["clipper-test"],
                    }),
                  },
                },
              );
              setTestStatus(
                `HTTP ${res.status} · ${res.body.slice(0, 200) || "(空响应)"}`,
              );
              refreshLog();
            } catch (e) {
              setTestStatus("失败：" + String(e));
            } finally {
              setTesting(false);
            }
          }}
        >
          {testing ? "正在发送…" : "🚀 一键测试发送"}
        </button>
        {testStatus && (
          <code className="plugin-clipper-example" style={{ flex: 1 }}>
            {testStatus}
          </code>
        )}
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

      <h4>3.1 详细操作步骤（完全对齐 Obsidian Web Clipper）</h4>
      <ol className="plugin-clipper-steps">
        <li>
          <strong>安装扩展</strong>：
          <ul>
            <li>Chrome / Edge：在 Chrome Web Store 搜索 <em>Obsidian Web Clipper</em> 安装。</li>
            <li>Firefox：在 Add-ons 应用市场搜索同名扩展安装。</li>
            <li>Safari：从 App Store 安装 Obsidian Web Clipper Safari Extension。</li>
          </ul>
        </li>
        <li>
          <strong>连接本应用</strong>：在浏览器扩展 <em>Settings · General</em> 中：
          <ul>
            <li>把 <em>Vault</em> 选项切换到 <em>Custom URL</em> 或 <em>Webhook</em>。</li>
            <li>URL 填入：<code>{httpEndpoint}</code></li>
            <li>添加 Header：<code>X-Clip-Token</code> = 上方"复制"按钮取到的 token。</li>
            <li>Method 选 <code>POST</code>，Body 选 <code>JSON</code>。</li>
          </ul>
        </li>
        <li>
          <strong>创建模板</strong>：在扩展 <em>Settings · Templates</em> 新建：
          <ul>
            <li>Name：例如"剪藏到全视维"。</li>
            <li>Trigger：根据网页规则（可留空使用默认）。</li>
            <li>Behavior：<em>Custom URL</em> 或 <em>Webhook</em>。</li>
            <li>Output：勾选 <em>Include frontmatter</em>，按需勾选 <em>Selection only</em>、<em>Convert images to base64</em>。</li>
          </ul>
        </li>
        <li>
          <strong>模板变量对照表</strong>（粘贴到 URL 或 Body 模板）：
          <pre className="plugin-clipper-code">
{`{{title}}              页面标题
{{url}}                源 URL
{{content}}            完整 Markdown 正文
{{selectionMarkdown}}  仅当前选区
{{tags}}               以逗号分隔的标签
{{date}}               当前日期 YYYY-MM-DD
{{readingTime}}        预计阅读时间
{{author}} {{site}}    站点元数据`}
          </pre>
        </li>
        <li>
          <strong>Behavior 三种模式</strong>：
          <ul>
            <li><em>Open in browser</em>：扩展打开 <code>quanshiwei://clip?...</code>，由 OS 唤起应用。</li>
            <li><em>Custom URL (POST)</em>：扩展直接 POST 到 <code>{httpEndpoint}</code>，最稳。</li>
            <li><em>Copy to clipboard</em>：仅复制 Markdown，由你手动粘贴到本应用。</li>
          </ul>
        </li>
        <li>
          <strong>截取范围</strong>：
          <ul>
            <li><em>Full page</em>：默认，整页 Markdown。</li>
            <li><em>Selection only</em>：仅当前选区。</li>
            <li><em>Reader view</em>：先进入阅读视图再剪藏，去除广告/侧栏。</li>
            <li><em>Highlight only</em>：搭配 <code>{`{{selectionMarkdown}}`}</code> 仅传高亮。</li>
          </ul>
        </li>
        <li>
          <strong>测试剪藏</strong>：在任意网页打开扩展弹窗，选择模板，点击 <em>Clip</em>。
          应用端会出现一条「剪藏完成」通知；本面板「最近请求」会即时刷新。
        </li>
        <li>
          <strong>故障排查</strong>：
          <ul>
            <li><code>401</code>：X-Clip-Token 未填或不匹配。点击上方"重新生成"后同步到扩展。</li>
            <li><code>400</code>：请求体不是合法 JSON。检查扩展 Body 选项与 Content-Type。</li>
            <li><code>未返回 page_name</code>：是 journal 模式，已追加到今日 journal。</li>
            <li>页面无变化：本面板「最近请求」也未出现 → 检查扩展 URL/Header；
              再试 <code>GET http://127.0.0.1:33333/health</code>。</li>
          </ul>
        </li>
      </ol>

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
