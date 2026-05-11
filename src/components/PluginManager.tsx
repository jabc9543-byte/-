import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { usePluginStore, type MarketplaceEntry } from "../stores/plugins";
import { BUNDLED_PLUGINS } from "../plugins/bundled";

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
  const exampleUrl =
    "quanshiwei://clip?title=Example&url=https%3A%2F%2Fexample.com&body=Hello%20from%20clipper&tags=demo,clip";
  const obsidianTemplate =
    "quanshiwei://clip?title={{title}}&url={{url}}&body={{content}}&tags={{tags}}";
  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="plugin-clipper">
      <p>
        全视维内置 <strong>Web Clipper 接收器</strong>，可以接收来自浏览器扩展
        （如 <em>Obsidian Web Clipper</em>）的剪藏，写入今日 journal 或新建页面。
      </p>
      <h4>1. URL Scheme</h4>
      <p>系统已注册 <code>quanshiwei://</code>（兼容 <code>lsrs://</code>）协议：</p>
      <pre className="plugin-clipper-code">
        {`quanshiwei://clip?title=<标题>&url=<原文 URL>&body=<Markdown 正文>&tags=<标签,逗号分隔>&mode=<page|journal>`}
      </pre>
      <p className="plugin-clipper-hint">
        所有参数都需 URL 编码。省略 <code>mode</code> 时：有标题→新建页面；无标题→
        追加到今日 journal。
      </p>
      <h4>2. 测试链接</h4>
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
      <h4>4. 安全说明</h4>
      <ul className="plugin-clipper-notes">
        <li>剪藏内容以纯文本写入，<strong>不会执行</strong>任何脚本。</li>
        <li>仅 <code>quanshiwei</code> / <code>lsrs</code> 两个 scheme 会被处理。</li>
        <li>桌面端首次使用需在系统中允许应用注册协议。</li>
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
