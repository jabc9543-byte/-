import { useEffect, useState } from "react";
import { usePageStore } from "../stores/page";
import { useWhiteboardStore } from "../stores/whiteboard";
import { useFavoritesStore } from "../stores/favorites";
import { BlockTree } from "./BlockTree";
import { Backlinks } from "./Backlinks";
import { AliasEditor } from "./AliasEditor";
import { PageTocPanel } from "./PageTocPanel";

export function PageView() {
  const page = usePageStore((s) => s.page);
  const blocks = usePageStore((s) => s.blocks);
  const insertTopLevel = usePageStore((s) => s.insertTopLevel);
  const activeId = usePageStore((s) => s.activePageId);
  const showPageGraph = useWhiteboardStore((s) => s.showPageGraph);
  const favorites = useFavoritesStore((s) => s.favorites);
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);

  const [title, setTitle] = useState("");
  useEffect(() => {
    setTitle(page?.name ?? "");
  }, [page?.name]);

  if (!activeId) {
    return (
      <div style={{ color: "var(--fg-muted)", marginTop: 40 }}>
        在左侧选择或创建一个页面。
      </div>
    );
  }
  if (!page) return null;

  const roots = blocks.filter((b) => b.parent_id === null);
  const isFav = favorites.includes(page.id);

  return (
    <div>
      <div className="page-header">
        <h1>{title}</h1>
        <div className="page-header-actions">
          <button
            className={`page-fav-btn${isFav ? " on" : ""}`}
            onClick={() => toggleFavorite(page.id)}
            title={isFav ? "取消收藏" : "收藏此页面"}
            aria-label={isFav ? "取消收藏" : "收藏此页面"}
          >
            {isFav ? "★" : "☆"}
          </button>
          <button
            className="page-action-btn"
            onClick={() => showPageGraph(page.id)}
            title="查看本页面的引用图谱"
          >
            页面图谱
          </button>
        </div>
      </div>
      <AliasEditor page={page} />
      <PageTocPanel />
      <BlockTree blocks={blocks} parentId={null} />
      {roots.length === 0 && (
        <button
          onClick={() => insertTopLevel("")}
          style={{
            marginTop: 12,
            background: "transparent",
            border: "1px dashed var(--border)",
            color: "var(--fg-muted)",
            padding: "8px 12px",
            borderRadius: 4,
          }}
        >
          + 第一个块
        </button>
      )}
      <Backlinks pageName={page.name} />
    </div>
  );
}
