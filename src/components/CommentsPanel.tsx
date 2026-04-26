import { useEffect, useMemo, useState } from "react";
import type { Comment } from "../types";
import { useCommentsStore } from "../stores/comments";
import { usePageStore } from "../stores/page";

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

interface CommentItemProps {
  comment: Comment;
  replies: Comment[];
  onReply: (parentId: string) => void;
}

function CommentItem({ comment, replies, onReply }: CommentItemProps) {
  const update = useCommentsStore((s) => s.update);
  const toggleResolved = useCommentsStore((s) => s.toggleResolved);
  const remove = useCommentsStore((s) => s.remove);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);

  useEffect(() => {
    setDraft(comment.body);
  }, [comment.body]);

  const onSave = async () => {
    if (!draft.trim()) return;
    await update(comment.id, draft.trim());
    setEditing(false);
  };

  return (
    <div className={`comment-item${comment.resolved ? " comment-resolved" : ""}`}>
      <div className="comment-header">
        <span
          className="comment-avatar"
          style={{ background: comment.author_color }}
          title={comment.author}
        >
          {comment.author.slice(0, 1).toUpperCase()}
        </span>
        <div className="comment-meta">
          <div className="comment-author">{comment.author}</div>
          <div className="comment-time">{formatTime(comment.created_at)}</div>
        </div>
        <button
          className="comment-icon-btn"
          title={comment.resolved ? "重新打开" : "标记为已解决"}
          onClick={() => void toggleResolved(comment.id)}
        >
          {comment.resolved ? "↺" : "✓"}
        </button>
        <button
          className="comment-icon-btn"
          title="删除评论"
          onClick={() => void remove(comment.id)}
        >
          ×
        </button>
      </div>
      {editing ? (
        <div className="comment-edit">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            autoFocus
          />
          <div className="comment-edit-actions">
            <button className="comment-primary" onClick={() => void onSave()}>
              保存
            </button>
            <button
              className="comment-secondary"
              onClick={() => {
                setDraft(comment.body);
                setEditing(false);
              }}
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className="comment-body">{comment.body}</div>
      )}
      {!editing && !comment.resolved && (
        <div className="comment-actions">
          <button
            className="comment-link"
            onClick={() => setEditing(true)}
          >
            编辑
          </button>
          {!comment.parent_id && (
            <button
              className="comment-link"
              onClick={() => onReply(comment.id)}
            >
              回复
            </button>
          )}
        </div>
      )}
      {replies.length > 0 && (
        <div className="comment-replies">
          {replies.map((r) => (
            <CommentItem
              key={r.id}
              comment={r}
              replies={[]}
              onReply={onReply}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Side panel listing comments for the currently selected block.
 */
export function CommentsPanel() {
  const open = useCommentsStore((s) => s.panelOpen);
  const blockId = useCommentsStore((s) => s.selectedBlockId);
  const byBlock = useCommentsStore((s) => s.byBlock);
  const loading = useCommentsStore((s) => s.loading);
  const error = useCommentsStore((s) => s.error);
  const close = useCommentsStore((s) => s.closePanel);
  const add = useCommentsStore((s) => s.add);
  const blocks = usePageStore((s) => s.blocks);

  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);

  useEffect(() => {
    setDraft("");
    setReplyTo(null);
  }, [blockId]);

  const list = (blockId && byBlock[blockId]) || [];
  const block = blockId ? blocks.find((b) => b.id === blockId) : null;

  const [roots, repliesOf] = useMemo(() => {
    const roots = list.filter((c) => !c.parent_id);
    const repliesOf: Record<string, Comment[]> = {};
    for (const c of list) {
      if (c.parent_id) {
        (repliesOf[c.parent_id] ??= []).push(c);
      }
    }
    for (const k of Object.keys(repliesOf)) {
      repliesOf[k].sort(
        (a, b) => a.created_at.localeCompare(b.created_at),
      );
    }
    return [roots, repliesOf] as const;
  }, [list]);

  if (!open || !blockId) return null;

  const submit = async () => {
    if (!draft.trim()) return;
    await add(blockId, draft.trim(), replyTo);
    setDraft("");
    setReplyTo(null);
  };

  return (
    <>
      <div
        className="comments-panel-backdrop"
        onClick={close}
        aria-hidden="true"
      />
      <aside className="comments-panel" aria-label="块评论">
      <header className="comments-panel-header">
        <button
          type="button"
          className="comments-panel-back-btn"
          onClick={close}
          aria-label="返回"
        >
          ← 返回
        </button>
        <h3>评论</h3>
        <button
          className="comment-icon-btn"
          onClick={close}
          aria-label="关闭评论"
        >
          ×
        </button>
      </header>
      {block && (
        <div className="comments-panel-anchor" title={block.content}>
          {block.content.slice(0, 120) || "（空块）"}
        </div>
      )}
      <div className="comments-list">
        {loading && list.length === 0 && (
          <div className="comments-empty">加载中…</div>
        )}
        {!loading && list.length === 0 && (
          <div className="comments-empty">
            尚无评论，在下方开始讨论吧。
          </div>
        )}
        {roots.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            replies={repliesOf[c.id] ?? []}
            onReply={setReplyTo}
          />
        ))}
      </div>
      <div className="comments-compose">
        {replyTo && (
          <div className="comments-replying">
            正在回复
            <button
              type="button"
              className="comment-link"
              onClick={() => setReplyTo(null)}
            >
              取消
            </button>
          </div>
        )}
        <textarea
          placeholder="写下评论…（Ctrl+Enter 发送）"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          rows={3}
        />
        <div className="comments-compose-actions">
          <button
            className="comment-primary"
            disabled={!draft.trim()}
            onClick={() => void submit()}
          >
            发送
          </button>
        </div>
      </div>
      {error && <div className="comments-error">{error}</div>}
    </aside>
    </>
  );
}
