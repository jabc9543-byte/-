import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { usePluginStore, type MarketplaceEntry } from "../stores/plugins";

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

  const [tab, setTab] = useState<"installed" | "market">("installed");
  const [newUrl, setNewUrl] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    if (tab === "market" && listings.length === 0 && registries.length > 0) {
      refreshMarketplace().catch(() => {});
    }
  }, [tab, listings.length, registries.length, refreshMarketplace]);

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
                尚未安装插件。请选择包含 <code>plugin.json</code> 的文件夹。
              </li>
            )}
            {list.map((p) => {
              const pluginCommands = commands.filter((c) => c.pluginId === p.manifest.id);
              return (
                <li key={p.manifest.id} className={`plugin-card${p.enabled ? " enabled" : ""}`}>
                  <div className="plugin-title">
                    <span className="plugin-name">{p.manifest.name}</span>
                    <span className="plugin-version">v{p.manifest.version || "?"}</span>
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
