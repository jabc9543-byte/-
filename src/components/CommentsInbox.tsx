import { useEffect } from "react";
import { useCommentsStore } from "../stores/comments";
import { usePageStore } from "../stores/page";

/**
 * Global drawer showing all unresolved comment threads across the graph.
 */
export function CommentsInbox() {
  const inboxOpen = useCommentsStore((s) => s.inboxOpen);
  const open = useCommentsStore((s) => s.open);
  const refreshOpen = useCommentsStore((s) => s.refreshOpen);
  const openPanel = useCommentsStore((s) => s.openPanel);
  const toggleInbox = useCommentsStore((s) => s.toggleInbox);
  const blocks = usePageStore((s) => s.blocks);
  const openPage = usePageStore((s) => s.openPage);

  useEffect(() => {
    if (inboxOpen) refreshOpen().catch(() => {});
  }, [inboxOpen, refreshOpen]);

  if (!inboxOpen) return null;

  const goTo = async (blockId: string) => {
    const b = blocks.find((x) => x.id === blockId);
    if (b) {
      await openPage(b.page_id);
    }
    await openPanel(blockId);
  };

  return (
    <>
      <div
        className="comments-panel-backdrop"
        onClick={toggleInbox}
        aria-hidden="true"
      />
      <aside className="comments-inbox" aria-label="评论收件箱">
      <header className="comments-panel-header">
        <button
          type="button"
          className="comments-panel-back-btn"
          onClick={toggleInbox}
          aria-label="返回"
        >
          ← 返回
        </button>
        <h3>待处理评论（{open.length}）</h3>
        <button
          className="comment-icon-btn"
          onClick={toggleInbox}
          aria-label="关闭收件箱"
        >
          ×
        </button>
      </header>
      <div className="comments-inbox-list">
        {open.length === 0 && (
          <div className="comments-empty">没有未处理的评论。🎉</div>
        )}
        {open.map((c) => (
          <button
            key={c.id}
            type="button"
            className="comments-inbox-item"
            onClick={() => void goTo(c.block_id)}
          >
            <span
              className="comment-avatar"
              style={{ background: c.author_color }}
            >
              {c.author.slice(0, 1).toUpperCase()}
            </span>
            <span className="comments-inbox-body">
              <span className="comment-author">{c.author}</span>
              <span className="comments-inbox-snippet">
                {c.body.length > 140 ? c.body.slice(0, 140) + "…" : c.body}
              </span>
            </span>
          </button>
        ))}
      </div>
    </aside>
    </>
  );
}
