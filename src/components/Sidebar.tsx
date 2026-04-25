import { useState } from "react";
import { usePageStore } from "../stores/page";
import { useGraphStore } from "../stores/graph";
import { useWhiteboardStore } from "../stores/whiteboard";
import { useFavoritesStore } from "../stores/favorites";
import { useHelpStore } from "../stores/help";
import { JournalTimeline } from "./JournalTimeline";
import { WhiteboardList } from "./WhiteboardList";
import { TransferMenu } from "./TransferMenu";
import { AddGraphMenu } from "./AddGraphMenu";

export function Sidebar() {
  const pages = usePageStore((s) => s.pages);
  const activeId = usePageStore((s) => s.activePageId);
  const openPage = usePageStore((s) => s.openPage);
  const createPage = usePageStore((s) => s.createPage);
  const openToday = usePageStore((s) => s.openToday);
  const closeGraph = useGraphStore((s) => s.close);
  const graph = useGraphStore((s) => s.graph);
  const showPage = useWhiteboardStore((s) => s.showPage);
  const showGraph = useWhiteboardStore((s) => s.showGraph);
  const showCalendar = useWhiteboardStore((s) => s.showCalendar);
  const showPdf = useWhiteboardStore((s) => s.showPdf);
  const showDashboard = useWhiteboardStore((s) => s.showDashboard);
  const showSearch = useWhiteboardStore((s) => s.showSearch);
  const view = useWhiteboardStore((s) => s.view);

  const favorites = useFavoritesStore((s) => s.favorites);
  const recents = useFavoritesStore((s) => s.recents);
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);

  const [query, setQuery] = useState("");
  const nonJournal = pages.filter((p) => p.journal_day === null);
  const filtered = nonJournal.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase()),
  );

  const gotoPage = (id: string) => {
    showPage();
    openPage(id);
  };

  const onCreate = async () => {
    const name = prompt("新页面名称：");
    if (!name) return;
    const page = await createPage(name);
    gotoPage(page.id);
  };

  const onToday = () => {
    showPage();
    openToday();
  };

  const pageActive = view.kind === "page";

  const pageById = (id: string) => pages.find((p) => p.id === id);

  return (
    <aside className="sidebar">
      <header>
        <span title={graph?.root}>{graph?.name ?? "—"}</span>
        <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>
          {graph?.kind}
        </span>
        <AddGraphMenu />
      </header>
      <div className="search">
        <input
          placeholder="筛选页面…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="sidebar-scroll">
        <JournalTimeline />

        {favorites.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">
              <span>收藏页面</span>
            </div>
            <div className="page-list">
              {favorites.map((id) => {
                const p = pageById(id);
                if (!p) return null;
                return (
                  <button
                    key={id}
                    className={pageActive && id === activeId ? "active" : ""}
                    onClick={() => gotoPage(id)}
                    title={p.name}
                  >
                    ★ {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {recents.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">
              <span>最近使用</span>
            </div>
            <div className="page-list">
              {recents.slice(0, 8).map((id) => {
                const p = pageById(id);
                if (!p) return null;
                return (
                  <button
                    key={id}
                    className={pageActive && id === activeId ? "active" : ""}
                    onClick={() => gotoPage(id)}
                    title={p.name}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="sidebar-section">
          <div className="sidebar-section-title">
            <span>页面</span>
            <button onClick={onCreate} title="新建页面">+</button>
          </div>
          <div className="page-list">
            {filtered.map((p) => {
              const fav = favorites.includes(p.id);
              return (
                <div
                  key={p.id}
                  className={`page-list-row${
                    pageActive && p.id === activeId ? " active" : ""
                  }`}
                >
                  <button
                    className="page-list-main"
                    onClick={() => gotoPage(p.id)}
                    title={p.name}
                  >
                    {p.name}
                  </button>
                  <button
                    className={`page-list-fav${fav ? " on" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(p.id);
                    }}
                    title={fav ? "取消收藏" : "收藏"}
                    aria-label={fav ? "取消收藏" : "收藏"}
                  >
                    {fav ? "★" : "☆"}
                  </button>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: 14, color: "var(--fg-muted)", fontSize: 12 }}>
                没有页面。
              </div>
            )}
          </div>
        </div>
        <WhiteboardList />
      </div>
      <footer>
        <button onClick={onToday}>今日</button>
        <button
          className={view.kind === "graph" ? "active" : ""}
          onClick={showGraph}
          title="打开引用图谱"
        >
          图谱
        </button>
        <button
          className={view.kind === "pdf" ? "active" : ""}
          onClick={showPdf}
          title="打开 PDF / Zotero 库"
        >
          PDF
        </button>
        <button
          className={view.kind === "calendar" ? "active" : ""}
          onClick={showCalendar}
          title="打开日历视图"
        >
          日历
        </button>
        <button
          className={view.kind === "dashboard" ? "active" : ""}
          onClick={showDashboard}
          title="打开仪表盘"
        >
          仪表盘
        </button>
        <button
          className={view.kind === "search" ? "active" : ""}
          onClick={showSearch}
          title="打开全文搜索（关键字 + 语义）"
        >
          搜索
        </button>
        <button
          className={view.kind === "agenda" ? "active" : ""}
          onClick={() => {
            console.log("[sidebar] 日程 clicked");
            useWhiteboardStore.getState().showAgenda();
          }}
          title="打开日程（按日期的任务）"
        >
          日程
        </button>
        <TransferMenu />
        <button
          onClick={() => {
            console.log("[help] sidebar 帮助 clicked");
            useHelpStore.getState().show();
          }}
          title="帮助"
        >
          帮助
        </button>
        <button onClick={closeGraph}>关闭</button>
      </footer>
    </aside>
  );
}
