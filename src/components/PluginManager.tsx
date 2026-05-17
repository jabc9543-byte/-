import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { usePluginStore, type MarketplaceEntry, type PluginManifest } from "../stores/plugins";
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
  const [previewFor, setPreviewFor] = useState<string | null>(null);

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
                              className="plugin-detail-btn"
                              onClick={() => setPreviewFor(manifest.id)}
                            >
                              查看详情
                            </button>
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
      {previewFor && (
        <PluginPreviewModal
          pluginId={previewFor}
          onClose={() => setPreviewFor(null)}
          onInstall={async (m, src) => {
            setBusy(m.id);
            try {
              await installBundled(m, src);
              setPreviewFor(null);
            } catch (e) {
              alert(`安装失败：${String(e)}`);
            } finally {
              setBusy(null);
            }
          }}
          isInstalled={installedById.has(previewFor)}
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
      "2) 从 GitHub Releases 下载 quanshiwei-web-clipper-v*.zip ，解压后加载到 Chrome/Edge 「开发者模式」。",
      "3) 在扩展 Settings 中粘贴 token。",
      "4) 任意网页右键「剪藏到全视维」，内容会立即写入今日 journal。",
      "5) 想验证管道可点击 Clipper 面板的「🚀 一键测试发送」。",
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
    "com.logseqrs.calendar": [
      "1) 命令「Calendar：打开本月日历」会弹窗，圆点 = 已写 journal，[今天] 高亮。",
      "2) 在弹窗内输入数字（1~31）跳到那一天；输入 < 上月 / > 下月 / t 回到今天。",
      "3) 想直接看今天，运行「Calendar：跳到今天」即可。",
      "4) 在任意块输入 /calendar 也能呼出。",
    ],
    "com.logseqrs.quick-add": [
      "1) 速记：命令「QuickAdd：速记到 Inbox」→ 弹窗输入 → 自动写到 Inbox 页。",
      "2) 模板：命令「QuickAdd：新建论文笔记」→ 输入标题 → 自动写出固定结构。",
      "3) 追加：命令「QuickAdd：追加到面试题库」→ 题干 + 答案 → 追加到「面试题库」页。",
      "4) 也可用斜杠：/qa-capture、/qa-paper、/qa-append。",
    ],
    "com.logseqrs.templates": [
      "1) 在图谱里新建一个名为「99-Templates」的页面。",
      "2) 每个一级块就是一个模板：第一行写模板名，子块写内容；变量可用 {{date}} {{time}} {{title}}。",
      "3) 在任意块输入 /insert-template 或运行命令「Insert template」，会按编号选择模板。",
      "4) 选好后变量会自动替换为今日日期 / 时间 / 你输入的标题。",
    ],
    "com.logseqrs.claudian": [
      "1) 先新建一个名为「00-Claudian-Config」的页面（用作配置存放处）。",
      "2) 运行命令「Claudian：配置 API Key」，粘贴 Anthropic Claude API Key、模型、端点。",
      "3) 在任意块输入 /ai-summary（总结）、/ai-explain（解释概念）、/ai-review（面试复盘）。",
      "4) Claude 的输出会直接替换/写入当前块。",
    ],
    "com.logseqrs.git-sync": [
      "1) 先新建一个名为「00-Git-Config」的页面。",
      "2) 运行命令「Git：配置仓库与 Token」，填 owner/repo、分支、可选 PAT。",
      "3) 运行「Git：复制自动 commit&push 脚本」拿到 PowerShell / bash 脚本，粘贴到本地终端做初始化与自动同步。",
      "4) 运行「Git：查看最近 commit」查最近 10 条；改乱了可去 GitHub 一键 Revert。",
      "5) 在任意块输入 /git-status 把最近 5 条 commit 写入笔记。",
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

// Pre-install preview modal: takes a bundled plugin manifest and shows the
// same level of detail as PluginDetailModal but without requiring the plugin
// to be installed (commands/slash lists are derived from manifest metadata).
function PluginPreviewModal({
  pluginId,
  onClose,
  onInstall,
  isInstalled,
}: {
  pluginId: string;
  onClose: () => void;
  onInstall: (m: PluginManifest, source: string) => void | Promise<void>;
  isInstalled: boolean;
}) {
  const entry = BUNDLED_PLUGINS.find((b) => b.manifest.id === pluginId);
  if (!entry) return null;
  const m = entry.manifest;

  // Derive command/slash lists by parsing the bundled source (we register via
  // `def("id", "label", …)`, `logseq.commands.register("id","label",…)` and
  // `logseq.slash.register("/x","label",…)`).
  const src = entry.source;
  const cmdMatches: { id: string; label: string }[] = [];
  const slashMatches: { trigger: string; label: string }[] = [];
  const cmdRe =
    /(?:logseq\.commands\.register|def)\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g;
  const slashRe =
    /logseq\.slash\.register\s*\(\s*["'](\/[^"']+)["']\s*,\s*["']([^"']+)["']/g;
  let mm: RegExpExecArray | null;
  while ((mm = cmdRe.exec(src))) cmdMatches.push({ id: mm[1], label: mm[2] });
  while ((mm = slashRe.exec(src)))
    slashMatches.push({ trigger: mm[1], label: mm[2] });

  const guides: Record<string, string[]> = {
    "com.logseqrs.web-clipper": [
      "1) 点击下方「安装」按钮安装插件。",
      "2) 在「插件 → Clipper」面板查看 token 与本地端点。",
      "3) 安装并启用「全视维 Web Clipper」浏览器扩展（下载链接见 GitHub Release），把 token 粘贴进去。",
      "4) 在任意网页右键「剪藏到全视维」，内容会立即写入今日 journal。",
      "5) 想验证管道可点击 Clipper 面板的「🚀 一键测试发送」。",
    ],
    "com.logseqrs.insert-helpers": [
      "1) 安装并启用本插件。",
      "2) 在任意块中输入 /formula、/inline-formula、/link、/image-url、/code、/table-2x2、/hr 之一。",
      "3) 按提示输入即可。",
    ],
    "com.logseqrs.weather-stamp": [
      "1) 安装并启用本插件。",
      "2) 运行命令「天气：写入今日天气」即可在今日 journal 追加一行天气。",
      "3) 插件通过 Tauri 原生 HTTP 调用 wttr.in ，不受浏览器 CORS 限制。",
    ],
    "com.logseqrs.calendar": [
      "1) 安装并启用本插件。",
      "2) 命令「Calendar：打开本月日历」弹窗显示当月圆点 + 今天高亮。",
      "3) 弹窗内输入数字跳那天，< / > 翻月，t 回到今天。",
    ],
    "com.logseqrs.quick-add": [
      "1) 安装并启用本插件。",
      "2) /qa-capture 速记到 Inbox；/qa-paper 新建论文笔记；/qa-append 追加到面试题库。",
      "3) 也可在命令面板直接搜「QuickAdd」选择动作。",
    ],
    "com.logseqrs.templates": [
      "1) 新建一个名为「99-Templates」的页面。",
      "2) 每个一级块=一个模板，第一行写模板名；变量 {{date}} {{time}} {{title}}。",
      "3) /insert-template 即可挑选并把模板插入当前块。",
    ],
    "com.logseqrs.claudian": [
      "1) 新建一个名为「00-Claudian-Config」的页面。",
      "2) 运行「Claudian：配置 API Key」保存 Claude Key/模型/端点。",
      "3) /ai-summary 总结、/ai-explain 解释、/ai-review 复盘。",
    ],
    "com.logseqrs.git-sync": [
      "1) 新建「00-Git-Config」页面。",
      "2) 运行「Git：配置仓库与 Token」。",
      "3) 「Git：复制自动 commit&push 脚本」拿到一键脚本，本地终端跑即可。",
      "4) 「Git：查看最近 commit」可在沙箱内直接看 GitHub commit 列表。",
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
              {isInstalled && (
                <span className="plugin-market-badge installed" style={{ marginLeft: 8 }}>
                  已安装
                </span>
              )}
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
          {cmdMatches.length > 0 && (
            <section>
              <h4>命令（{cmdMatches.length}）</h4>
              <ul className="plugin-detail-cmd-list">
                {cmdMatches.map((c) => (
                  <li key={c.id}>
                    <span className="plugin-command" style={{ cursor: "default" }}>
                      ▸ {c.label}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {slashMatches.length > 0 && (
            <section>
              <h4>斜杠命令（{slashMatches.length}）</h4>
              <ul className="plugin-detail-slash-list">
                {slashMatches.map((s) => (
                  <li key={s.trigger}>
                    <code>{s.trigger}</code>
                    <span style={{ marginLeft: 8 }}>{s.label}</span>
                  </li>
                ))}
              </ul>
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
          <section style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="plugin-detail-btn" onClick={onClose}>
              关闭
            </button>
            {!isInstalled && (
              <button
                className="plugin-detail-demo"
                onClick={() => onInstall(m, entry.source)}
              >
                立即安装
              </button>
            )}
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
        全视维内置 <strong>Web Clipper 接收器</strong>，可以接收来自
        《全视维 Web Clipper》浏览器扩展的剪藏，写入今日 journal 或新建页面。
      </p>
      <p>
        支持两条接收通道：<strong>本地 HTTP 端口</strong>（推荐）和 <strong>URL Scheme</strong>。
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

      <h4>3. 全视维官方浏览器扩展</h4>
      <p>
        我们提供自研、零依赖的 <strong>全视维 Web Clipper</strong> 浏览器扩展，
        直接 <code>POST</code> 到本应用，不再依赖任何第三方剪藏工具。
        源码与可下载的安装包都在 GitHub 仓库。
      </p>
      <ol className="plugin-clipper-steps">
        <li>
          <strong>下载并解压</strong>：到 GitHub Releases 下载
          <code>quanshiwei-web-clipper-v*.zip</code> 并解压到任意位置。
        </li>
        <li>
          <strong>加载扩展</strong>：浏览器地址栏访问
          <code>chrome://extensions</code> / <code>edge://extensions</code>，
          打开「开发者模式」，点击「加载已解压的扩展」，选择解压目录。
        </li>
        <li>
          <strong>填入 token</strong>：点击工具栏的「全视维 Clipper」图标 → Settings，
          把上方复制的 token 粘贴进去并保存。
        </li>
        <li>
          <strong>开始剪藏</strong>：
          <ul>
            <li>点工具栏图标 → 「剪藏整页」：自动 Readability 提取正文 + 标题。</li>
            <li>选中网页文本 → 工具栏图标 → 「剪藏选区」：仅保存选区。</li>
            <li>右键链接 → 「剪藏到全视维」：保存 URL + 标题到今日 journal。</li>
          </ul>
        </li>
        <li>
          <strong>故障排查</strong>：
          <ul>
            <li><code>401</code>：token 不匹配，重新复制后保存到扩展。</li>
            <li><code>400</code>：扩展不是最新版，去 Releases 重新下载。</li>
            <li>连不上 33333：确认本应用运行中；防火墙允许「私有网络」。</li>
          </ul>
        </li>
      </ol>
      <p className="plugin-clipper-hint">
        想要自己接入？请求体格式见上面 <em>「请求体（JSON）」</em>。
        端点不变就能配合任何能发 POST 的工具（curl / fetch / 自动化脚本）。
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
