import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { usePageStore } from "../stores/page";
import { useWhiteboardStore } from "../stores/whiteboard";
import { useGraphStore } from "../stores/graph";
import { useSettingsStore } from "../stores/settings";
import { usePluginStore } from "../stores/plugins";
import type { Page } from "../types";

type CommandKind = "action" | "page" | "plugin";

interface CommandItem {
  id: string;
  kind: CommandKind;
  label: string;
  hint?: string;
  run: () => Promise<void> | void;
}

interface Props {
  onClose: () => void;
}

export function CommandPalette({ onClose }: Props) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [pages, setPages] = useState<Page[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const openPage = usePageStore((s) => s.openPage);
  const showPage = useWhiteboardStore((s) => s.showPage);
  const showGraph = useWhiteboardStore((s) => s.showGraph);
  const showPdf = useWhiteboardStore((s) => s.showPdf);
  const showCalendar = useWhiteboardStore((s) => s.showCalendar);
  const openToday = usePageStore((s) => s.openToday);
  const createWhiteboard = useWhiteboardStore((s) => s.create);
  const closeGraph = useGraphStore((s) => s.close);
  const refreshPages = usePageStore((s) => s.refreshPages);
  const spellcheck = useSettingsStore((s) => s.spellcheck);
  const toggleSpellcheck = useSettingsStore((s) => s.toggleSpellcheck);
  const pluginCommands = usePluginStore((s) => s.commands);
  const runPluginCommand = usePluginStore((s) => s.runCommand);
  const reloadGraph = async () => api.reloadGraph();

  useEffect(() => {
    inputRef.current?.focus();
    api.listPages().then(setPages).catch(() => {});
  }, []);

  const actions = useMemo<CommandItem[]>(
    () => [
      {
        id: "today",
        kind: "action",
        label: "打开今日日志",
        hint: "⌘T",
        run: async () => {
          showPage();
          await openToday();
        },
      },
      {
        id: "graph",
        kind: "action",
        label: "打开图谱视图",
        run: () => showGraph(),
      },
      {
        id: "pdf",
        kind: "action",
        label: "打开 PDF / Zotero 库",
        run: () => showPdf(),
      },
      {
        id: "calendar",
        kind: "action",
        label: "打开日历视图",
        hint: "日志与计划",
        run: () => showCalendar(),
      },
      {
        id: "new-page",
        kind: "action",
        label: "新建页面…",
        run: async () => {
          const name = prompt("新页面名称：");
          if (!name) return;
          const p = await usePageStore.getState().createPage(name);
          showPage();
          await openPage(p.id);
        },
      },
      {
        id: "new-board",
        kind: "action",
        label: "新建白板…",
        run: async () => {
          const name = prompt("新白板名称：");
          if (!name) return;
          await createWhiteboard(name);
        },
      },
      {
        id: "reload",
        kind: "action",
        label: "从磁盘重新加载图谱",
        run: async () => {
          await reloadGraph();
          await refreshPages();
        },
      },
      {
        id: "spellcheck",
        kind: "action",
        label: `${spellcheck ? "禁用" : "启用"}拼写检查`,
        run: () => toggleSpellcheck(),
      },
      {
        id: "plugins",
        kind: "action",
        label: "管理插件…",
        run: () => {
          window.dispatchEvent(new CustomEvent("logseq-rs:open-plugins"));
        },
      },
      {
        id: "templates",
        kind: "action",
        label: "插入块模板…",
        hint: "Mod+Shift+T",
        run: () => {
          window.dispatchEvent(new CustomEvent("logseq-rs:open-templates"));
        },
      },
      {
        id: "backlinks-toggle",
        kind: "action",
        label: "切换反向链接面板",
        hint: "Mod+Shift+L",
        run: () => {
          window.dispatchEvent(new CustomEvent("logseq-rs:toggle-backlinks"));
        },
      },
      {
        id: "dashboard",
        kind: "action",
        label: "打开仪表盘",
        hint: "Mod+Shift+B",
        run: () => {
          useWhiteboardStore.getState().showDashboard();
        },
      },
      {
        id: "settings",
        kind: "action",
        label: "打开设置…",
        hint: "协作、拼写检查…",
        run: () => {
          window.dispatchEvent(new CustomEvent("logseq-rs:open-settings"));
        },
      },
      {
        id: "help",
        kind: "action",
        label: "帮助 / 快捷键…",
        hint: "?",
        run: () => {
          window.dispatchEvent(new CustomEvent("logseq-rs:open-help"));
        },
      },
      {
        id: "toggle-collab",
        kind: "action",
        label: `${useSettingsStore.getState().collab.enabled ? "禁用" : "启用"}协作`,
        run: () => useSettingsStore.getState().toggleCollab(),
      },
      {
        id: "close",
        kind: "action",
        label: "关闭图谱 / 返回首页",
        run: () => closeGraph(),
      },
    ],
    [
      showPage,
      openToday,
      showGraph,
      showPdf,
      showCalendar,
      openPage,
      createWhiteboard,
      refreshPages,
      spellcheck,
      toggleSpellcheck,
      closeGraph,
    ],
  );

  const pageCmds = useMemo<CommandItem[]>(
    () =>
      pages.flatMap((p) => {
        const aliases = Array.isArray(
          (p.properties as Record<string, unknown>).aliases,
        )
          ? ((p.properties as Record<string, unknown>).aliases as unknown[]).filter(
              (x): x is string => typeof x === "string",
            )
          : [];
        const main: CommandItem = {
          id: `page:${p.id}`,
          kind: "page",
          label: p.name,
          hint: p.journal_day ? "日志" : "页面",
          run: async () => {
            showPage();
            await openPage(p.id);
          },
        };
        const aliasCmds: CommandItem[] = aliases.map((a) => ({
          id: `page:${p.id}:alias:${a}`,
          kind: "page",
          label: a,
          hint: `别名 → ${p.name}`,
          run: async () => {
            showPage();
            await openPage(p.id);
          },
        }));
        return [main, ...aliasCmds];
      }),
    [pages, openPage, showPage],
  );

  const pluginCmds = useMemo<CommandItem[]>(
    () =>
      pluginCommands.map((c) => ({
        id: `plugin:${c.pluginId}:${c.id}`,
        kind: "plugin",
        label: c.label,
        hint: c.pluginId,
        run: () => runPluginCommand(c.pluginId, c.id),
      })),
    [pluginCommands, runPluginCommand],
  );

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = [...actions, ...pluginCmds, ...pageCmds];
    if (!needle) return all.slice(0, 80);
    return all
      .filter((c) => c.label.toLowerCase().includes(needle))
      .slice(0, 80);
  }, [q, actions, pluginCmds, pageCmds]);

  useEffect(() => {
    setIdx(0);
  }, [q]);

  const run = async (cmd: CommandItem | undefined) => {
    if (!cmd) return;
    onClose();
    try {
      await cmd.run();
    } catch (e) {
      console.error(e);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(matches[idx]);
    }
  };

  return (
    <div className="cmdp-backdrop" onClick={onClose}>
      <div className="cmdp" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdp-input"
          placeholder="执行命令或跳转到页面…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="cmdp-list">
          {matches.map((c, i) => (
            <button
              key={c.id}
              className={`cmdp-item${i === idx ? " active" : ""}`}
              onMouseEnter={() => setIdx(i)}
              onClick={() => run(c)}
            >
              <span className="cmdp-badge">
                {c.kind === "page" ? "📄" : c.kind === "plugin" ? "🧩" : "⚡"}
              </span>
              <span className="cmdp-label">{c.label}</span>
              {c.hint && <span className="cmdp-hint">{c.hint}</span>}
            </button>
          ))}
          {matches.length === 0 && (
            <div className="cmdp-empty">无匹配项。</div>
          )}
        </div>
      </div>
    </div>
  );
}
