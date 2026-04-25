import { useEffect, useState } from "react";
import type { Block, BlockId } from "../types";
import { api } from "../api";
import { usePageStore } from "../stores/page";

interface Props {
  blockId: BlockId;
}

// Renders a read-only preview of a referenced block (`((uuid))` syntax).
// Clicking the card jumps to the block's host page.
export function BlockEmbed({ blockId }: Props) {
  const [block, setBlock] = useState<Block | null>(null);
  const [pageName, setPageName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const openPage = usePageStore((s) => s.openPage);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getBlock(blockId)
      .then(async (b) => {
        if (cancelled) return;
        setBlock(b);
        if (b) {
          const p = await api.getPage(b.page_id);
          if (!cancelled) setPageName(p?.name ?? b.page_id);
        }
      })
      .catch(() => {
        if (!cancelled) setBlock(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [blockId]);

  if (loading) {
    return <div className="block-embed block-embed-loading">加载中…</div>;
  }
  if (!block) {
    return (
      <div className="block-embed block-embed-missing">
        引用的块 <code>(({blockId}))</code> 已不存在。
      </div>
    );
  }

  return (
    <div
      className="block-embed"
      onClick={() => openPage(block.page_id)}
      title={`打开 ${pageName ?? block.page_id}`}
    >
      <div className="block-embed-source">
        <span className="block-embed-bullet">◉</span>
        <span className="block-embed-page">{pageName ?? block.page_id}</span>
      </div>
      <div className="block-embed-content">{block.content || <em>（空）</em>}</div>
    </div>
  );
}
