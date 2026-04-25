import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { PageView } from "./PageView";
import { WhiteboardView } from "./WhiteboardView";
import { GraphView } from "./GraphView";
import { CommandPalette } from "./CommandPalette";
import { PdfLibrary } from "./PdfLibrary";
import { CalendarView } from "./CalendarView";
import { TemplatePicker } from "./TemplatePicker";
import { BacklinksPanel } from "./BacklinksPanel";
import { Dashboard } from "./Dashboard";
import { SearchPanel } from "./SearchPanel";
import { AgendaView } from "./AgendaView";
import { PluginManager, PluginNotifications } from "./PluginManager";
import { SettingsModal, CollabPresence } from "./SettingsModal";
import { UpdateBanner } from "./UpdateBanner";
import { BlockHistoryPanel } from "./BlockHistoryPanel";
import { EncryptionLockScreen } from "./EncryptionLockScreen";
import { CommentsPanel } from "./CommentsPanel";
import { CommentsInbox } from "./CommentsInbox";
import { AiPanel } from "./AiPanel";
import { HelpPanel } from "./HelpPanel";
import { usePageStore } from "../stores/page";
import { useWhiteboardStore } from "../stores/whiteboard";
import { usePluginStore } from "../stores/plugins";
import { useGraphStore } from "../stores/graph";
import { useSettingsStore } from "../stores/settings";
import { useCollabStore } from "../stores/collab";
import { useKeymapStore } from "../stores/keymap";
import { useKeymapCommand } from "../hooks/useKeymapCommand";
import { useIsMobile } from "../hooks/useMediaQuery";
import { useEncryptionStore, selectLocked } from "../stores/encryption";
import { useCommentsStore } from "../stores/comments";
import { useBackupStore } from "../stores/backup";
import { useAiStore } from "../stores/ai";
import { useHelpStore } from "../stores/help";

export function Workspace() {
  const refresh = usePageStore((s) => s.refreshPages);
  const openToday = usePageStore((s) => s.openToday);
  const activeId = usePageStore((s) => s.activePageId);
  const refreshWhiteboards = useWhiteboardStore((s) => s.refreshList);
  const view = useWhiteboardStore((s) => s.view);
  const refreshPlugins = usePluginStore((s) => s.refresh);
  const dispatchEvent = usePluginStore((s) => s.dispatchEvent);
  const graph = useGraphStore((s) => s.graph);
  const collabCfg = useSettingsStore((s) => s.collab);
  const startCollab = useCollabStore((s) => s.start);
  const stopCollab = useCollabStore((s) => s.stop);
  const refreshEncryption = useEncryptionStore((s) => s.refresh);
  const clearEncryption = useEncryptionStore((s) => s.clear);
  const locked = useEncryptionStore(selectLocked);
  const [palette, setPalette] = useState(false);
  const [pluginMgr, setPluginMgr] = useState(false);
  const [settings, setSettings] = useState(false);
  const [templatePicker, setTemplatePicker] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [backlinksOpen, setBacklinksOpen] = useState(() => {
    const saved = localStorage.getItem("logseq-rs:backlinks-open");
    return saved === null ? true : saved === "1";
  });
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // On mobile a freshly opened page/view should automatically dismiss
  // the drawer so the user isn't stuck looking at the sidebar.
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile, view, activeId]);

  // Leaving mobile: make sure overlays aren't stuck visible.
  useEffect(() => {
    if (!isMobile) setSidebarOpen(false);
  }, [isMobile]);

  useEffect(() => {
    localStorage.setItem(
      "logseq-rs:backlinks-open",
      backlinksOpen ? "1" : "0",
    );
  }, [backlinksOpen]);

  useEffect(() => {
    refresh().then(() => {
      if (!activeId) openToday().catch(() => {});
    });
    refreshWhiteboards().catch(() => {});
    refreshPlugins().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    dispatchEvent("page:opened", { pageId: activeId });
  }, [activeId, dispatchEvent]);

  useEffect(() => {
    if (graph) {
      refreshEncryption().catch(() => {});
    } else {
      clearEncryption();
    }
  }, [graph?.root, refreshEncryption, clearEncryption]);

  // Comments: refresh inbox on graph open, and subscribe to Yjs "bump"
  // notifications so peer-side changes trigger a refetch.
  useEffect(() => {
    if (!graph) {
      useCommentsStore.getState().clear();
      useBackupStore.getState().clear();
      useAiStore.getState().clear();
      return;
    }
    useCommentsStore.getState().refreshOpen().catch(() => {});
    useBackupStore.getState().refresh().catch(() => {});
    useAiStore.getState().refreshConfig().catch(() => {});
  }, [graph?.root]);

  const collabDoc = useCollabStore((s) => s.doc);
  useEffect(() => {
    if (!collabDoc) return;
    const map = collabDoc.getMap<number>("comments_bump");
    const onBump = () => {
      const store = useCommentsStore.getState();
      store.refreshOpen().catch(() => {});
      if (store.selectedBlockId) {
        store.refreshBlock(store.selectedBlockId).catch(() => {});
      }
    };
    map.observe(onBump);
    return () => map.unobserve(onBump);
  }, [collabDoc]);

  useEffect(() => {
    const onOpenManager = () => setPluginMgr(true);
    window.addEventListener("logseq-rs:open-plugins", onOpenManager);
    return () => window.removeEventListener("logseq-rs:open-plugins", onOpenManager);
  }, []);

  useEffect(() => {
    const onOpenAi = () => setAiOpen(true);
    window.addEventListener("logseq-rs:open-ai", onOpenAi);
    return () =>
      window.removeEventListener("logseq-rs:open-ai", onOpenAi);
  }, []);

  useEffect(() => {
    const onOpenSettings = () => setSettings(true);
    window.addEventListener("logseq-rs:open-settings", onOpenSettings);
    return () => window.removeEventListener("logseq-rs:open-settings", onOpenSettings);
  }, []);

  useEffect(() => {
    const onOpenHelp = () => useHelpStore.getState().show();
    window.addEventListener("logseq-rs:open-help", onOpenHelp);
    return () => window.removeEventListener("logseq-rs:open-help", onOpenHelp);
  }, []);

  useEffect(() => {
    const onOpenTemplates = () => setTemplatePicker(true);
    window.addEventListener("logseq-rs:open-templates", onOpenTemplates);
    return () =>
      window.removeEventListener("logseq-rs:open-templates", onOpenTemplates);
  }, []);

  useEffect(() => {
    const onToggleBacklinks = () => setBacklinksOpen((v) => !v);
    window.addEventListener("logseq-rs:toggle-backlinks", onToggleBacklinks);
    return () =>
      window.removeEventListener(
        "logseq-rs:toggle-backlinks",
        onToggleBacklinks,
      );
  }, []);

  // Collaboration lifecycle: start a session whenever a graph is open and
  // collab is enabled in settings; stop otherwise. Re-runs on config change.
  useEffect(() => {
    if (graph && collabCfg.enabled) {
      startCollab({
        room: graph.name,
        serverUrl: collabCfg.serverUrl,
        name: collabCfg.displayName,
        color: collabCfg.color,
      });
      return () => stopCollab();
    }
    stopCollab();
    return undefined;
  }, [
    graph?.name,
    collabCfg.enabled,
    collabCfg.serverUrl,
    collabCfg.displayName,
    collabCfg.color,
    startCollab,
    stopCollab,
    graph,
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      useKeymapStore.getState().handleKeyEvent(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- Global keymap bindings (module 16) --------------------------------
  // Registered here so the dispatcher can call them. Defaults mirror the
  // previously hard-coded Ctrl+Shift+P / Ctrl+K behaviour, plus a handful
  // of useful actions that users can re-bind through Settings.
  const showPage = useWhiteboardStore((s) => s.showPage);
  const showGraph = useWhiteboardStore((s) => s.showGraph);
  const showCalendar = useWhiteboardStore((s) => s.showCalendar);
  const showPdf = useWhiteboardStore((s) => s.showPdf);
  const showDashboard = useWhiteboardStore((s) => s.showDashboard);
  const showSearch = useWhiteboardStore((s) => s.showSearch);
  const showAgenda = useWhiteboardStore((s) => s.showAgenda);
  useKeymapCommand(
    {
      id: "palette.open",
      label: "打开命令面板",
      defaultChord: "Mod+Shift+P",
      allowInEditable: true,
      run: () => setPalette(true),
    },
    [],
  );
  useKeymapCommand(
    {
      id: "palette.open.k",
      label: "打开命令面板（备用）",
      defaultChord: "Mod+K",
      // Do NOT allow in editable — Ctrl+K is used by the block editor to
      // insert a link.
      run: () => setPalette(true),
    },
    [],
  );
  useKeymapCommand(
    {
      id: "journal.today",
      label: "打开今日日志",
      defaultChord: "Mod+T",
      run: async () => {
        showPage();
        await usePageStore.getState().openToday();
      },
    },
    [showPage],
  );
  useKeymapCommand(
    {
      id: "view.graph",
      label: "打开图谱视图",
      defaultChord: "Mod+Shift+G",
      run: () => showGraph(),
    },
    [showGraph],
  );
  useKeymapCommand(
    {
      id: "view.calendar",
      label: "打开日历视图",
      defaultChord: "Mod+Shift+C",
      run: () => showCalendar(),
    },
    [showCalendar],
  );
  useKeymapCommand(
    {
      id: "view.pdf",
      label: "打开 PDF / Zotero 库",
      defaultChord: "Mod+Shift+D",
      run: () => showPdf(),
    },
    [showPdf],
  );
  useKeymapCommand(
    {
      id: "view.dashboard",
      label: "打开仪表盘",
      defaultChord: "Mod+Shift+B",
      run: () => showDashboard(),
    },
    [showDashboard],
  );
  useKeymapCommand(
    {
      id: "view.search",
      label: "打开搜索",
      defaultChord: "Mod+Shift+F",
      run: () => showSearch(),
    },
    [showSearch],
  );
  useKeymapCommand(
    {
      id: "view.agenda",
      label: "打开日程",
      defaultChord: "Mod+Shift+G",
      run: () => showAgenda(),
    },
    [showAgenda],
  );
  useKeymapCommand(
    {
      id: "settings.open",
      label: "打开设置",
      defaultChord: "Mod+,",
      run: () => setSettings(true),
    },
    [],
  );
  useKeymapCommand(
    {
      id: "plugins.open",
      label: "打开插件管理器",
      defaultChord: "",
      run: () => setPluginMgr(true),
    },
    [],
  );
  useKeymapCommand(
    {
      id: "templates.insert",
      label: "插入块模板…",
      defaultChord: "Mod+Shift+T",
      run: () => setTemplatePicker(true),
    },
    [],
  );
  useKeymapCommand(
    {
      id: "backlinks.toggle",
      label: "切换反向链接面板",
      defaultChord: "Mod+Shift+L",
      run: () => setBacklinksOpen((v) => !v),
    },
    [],
  );
  useKeymapCommand(
    {
      id: "comments.inbox",
      label: "切换评论收件箱",
      defaultChord: "Mod+Shift+M",
      run: () => useCommentsStore.getState().toggleInbox(),
    },
    [],
  );

  useKeymapCommand(
    {
      id: "ai.open",
      label: "切换 AI 助手",
      defaultChord: "Mod+Shift+A",
      run: () => setAiOpen((v) => !v),
    },
    [],
  );

  if (locked) {
    return <EncryptionLockScreen />;
  }

  return (
    <div
      className={[
        "app",
        backlinksOpen ? "has-backlinks" : "",
        isMobile ? "app-mobile" : "",
        isMobile && sidebarOpen ? "sidebar-open" : "",
        isMobile && backlinksOpen ? "backlinks-open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {isMobile && (
        <header className="mobile-topbar">
          <button
            className="mobile-menu-btn"
            aria-label="切换侧边栏"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            ☰
          </button>
          <span className="mobile-title">{graph?.name ?? "全视维"}</span>
          <button
            className="mobile-menu-btn"
            aria-label="切换反向链接"
            onClick={() => setBacklinksOpen((v) => !v)}
            title="反向链接"
          >
            ⤺
          </button>
        </header>
      )}
      <Sidebar />
      <main className="main">
        {view.kind === "whiteboard" ? (
          <WhiteboardView id={view.id} />
        ) : view.kind === "graph" ? (
          <GraphView />
        ) : view.kind === "page-graph" ? (
          <GraphView focusPageId={view.pageId} />
        ) : view.kind === "pdf" ? (
          <PdfLibrary onClose={() => useWhiteboardStore.getState().showPage()} />
        ) : view.kind === "calendar" ? (
          <CalendarView />
        ) : view.kind === "dashboard" ? (
          <Dashboard />
        ) : view.kind === "search" ? (
          <SearchPanel />
        ) : view.kind === "agenda" ? (
          <AgendaView />
        ) : (
          <PageView />
        )}
      </main>
      {backlinksOpen &&
        view.kind !== "graph" &&
        view.kind !== "page-graph" &&
        view.kind !== "pdf" &&
        view.kind !== "dashboard" &&
        view.kind !== "search" &&
        view.kind !== "agenda" && (
          <BacklinksPanel onClose={() => setBacklinksOpen(false)} />
        )}
      {isMobile && (sidebarOpen || backlinksOpen) && (
        <div
          className="mobile-backdrop"
          onClick={() => {
            setSidebarOpen(false);
            setBacklinksOpen(false);
          }}
        />
      )}
      <CollabPresence />
      <CommentsInboxToggle />
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      {templatePicker && (
        <TemplatePicker onClose={() => setTemplatePicker(false)} />
      )}
      {pluginMgr && (
        <div className="cmdp-backdrop" onClick={() => setPluginMgr(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <PluginManager onClose={() => setPluginMgr(false)} />
          </div>
        </div>
      )}
      {settings && (
        <div className="cmdp-backdrop" onClick={() => setSettings(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <SettingsModal onClose={() => setSettings(false)} />
          </div>
        </div>
      )}
      <PluginNotifications />
      <UpdateBanner />
      <BlockHistoryPanel />
      <CommentsPanel />
      <CommentsInbox />
      {aiOpen && <AiPanel onClose={() => setAiOpen(false)} />}
      <HelpPanel />
    </div>
  );
}

function CommentsInboxToggle() {
  const count = useCommentsStore((s) => s.open.length);
  const toggle = useCommentsStore((s) => s.toggleInbox);
  return (
    <button
      type="button"
      className={`comments-inbox-toggle${count > 0 ? " has-unread" : ""}`}
      onClick={toggle}
      title={count === 0 ? "评论收件箱" : `${count} 条未处理评论`}
      aria-label="切换评论收件箱"
    >
      💬
      {count > 0 && <span className="comments-inbox-badge">{count}</span>}
    </button>
  );
}
