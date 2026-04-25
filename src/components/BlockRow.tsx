import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import type { Block } from "../types";
import { usePageStore } from "../stores/page";
import { useSettingsStore } from "../stores/settings";
import { useCollabStore } from "../stores/collab";
import { useHistoryPanelStore } from "../stores/history";
import { useCommentsStore } from "../stores/comments";
import { QueryEmbed } from "./QueryEmbed";
import { BlockEmbed } from "./BlockEmbed";
import { TaskMarkerPill } from "./TaskMarkerPill";
import { InlineRefs } from "./InlineRefs";

interface Props {
  block: Block;
}

const QUERY_RE = /\{\{query\s+([\s\S]+?)\}\}/g;

function extractQueries(content: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  QUERY_RE.lastIndex = 0;
  while ((m = QUERY_RE.exec(content))) out.push(m[1].trim());
  return out;
}

type DropPos = "before" | "after" | "child" | null;

export function BlockRow({ block }: Props) {
  const update = usePageStore((s) => s.updateBlock);
  const insertSibling = usePageStore((s) => s.insertSibling);
  const del = usePageStore((s) => s.deleteBlock);
  const indent = usePageStore((s) => s.indent);
  const outdent = usePageStore((s) => s.outdent);
  const cycleTask = usePageStore((s) => s.cycleTask);
  const moveBlockTo = usePageStore((s) => s.moveBlockTo);
  const moveUp = usePageStore((s) => s.moveBlockUp);
  const moveDown = usePageStore((s) => s.moveBlockDown);
  const blocks = usePageStore((s) => s.blocks);
  const spellcheck = useSettingsStore((s) => s.spellcheck);
  const openHistory = useHistoryPanelStore((s) => s.open);
  const openComments = useCommentsStore((s) => s.openPanel);
  const commentsForBlock = useCommentsStore((s) => s.byBlock[block.id]);

  const ref = useRef<HTMLTextAreaElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(block.content);
  const [dropPos, setDropPos] = useState<DropPos>(null);
  const [focused, setFocused] = useState(false);

  // --- Collaborative editing binding ---
  const collabStatus = useCollabStore((s) => s.status);
  const collabActive = collabStatus === "connected" || collabStatus === "connecting";
  const getOrCreateText = useCollabStore((s) => s.getOrCreateText);
  const markDirty = useCollabStore((s) => s.markDirty);
  const setLocalPresence = useCollabStore((s) => s.setLocalPresence);
  const peers = useCollabStore((s) => s.peers);
  const ytextRef = useRef<Y.Text | null>(null);
  const applyingRemote = useRef(false);

  useEffect(() => {
    setValue(block.content);
  }, [block.content]);

  // Lazy-load comment counts for this block so the badge appears. The
  // store caches by block id so repeat mounts are cheap.
  useEffect(() => {
    if (commentsForBlock === undefined) {
      useCommentsStore.getState().refreshBlock(block.id).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id]);

  // Attach/detach Y.Text for this block when collab is active.
  useEffect(() => {
    if (!collabActive) {
      ytextRef.current = null;
      return;
    }
    let ytext: Y.Text;
    try {
      ytext = getOrCreateText(block.id, block.content);
    } catch {
      return;
    }
    ytextRef.current = ytext;
    // Initial sync: prefer the CRDT value once bound.
    const remote = ytext.toString();
    if (remote !== value) setValue(remote);

    const onChange = () => {
      const next = ytext.toString();
      const el = ref.current;
      applyingRemote.current = true;
      if (el && document.activeElement === el) {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        setValue(next);
        requestAnimationFrame(() => {
          if (!ref.current) return;
          const len = next.length;
          ref.current.selectionStart = Math.min(start, len);
          ref.current.selectionEnd = Math.min(end, len);
          applyingRemote.current = false;
        });
      } else {
        setValue(next);
        applyingRemote.current = false;
      }
    };
    ytext.observe(onChange);
    return () => {
      ytext.unobserve(onChange);
      ytextRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collabActive, block.id]);

  // Push local edits into the Y.Text (diff-based minimal replace).
  const syncToY = (next: string) => {
    const ytext = ytextRef.current;
    if (!ytext || applyingRemote.current) return;
    const prev = ytext.toString();
    if (prev === next) return;
    let start = 0;
    const min = Math.min(prev.length, next.length);
    while (start < min && prev[start] === next[start]) start++;
    let endPrev = prev.length;
    let endNext = next.length;
    while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
      endPrev--;
      endNext--;
    }
    ytext.doc?.transact(() => {
      if (endPrev > start) ytext.delete(start, endPrev - start);
      if (endNext > start) ytext.insert(start, next.slice(start, endNext));
    });
    markDirty(block.id);
  };

  const autoresize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  };

  useEffect(autoresize, [value]);

  const onBlur = async () => {
    if (value !== block.content) await update(block.id, value);
  };

  const wrapSelection = (prefix: string, suffix = prefix) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const before = value.slice(0, start);
    const sel = value.slice(start, end);
    const after = value.slice(end);
    const next = `${before}${prefix}${sel}${suffix}${after}`;
    setValue(next);
    if (collabActive) syncToY(next);
    requestAnimationFrame(() => {
      el.selectionStart = start + prefix.length;
      el.selectionEnd = end + prefix.length;
    });
  };

  const onKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Enter" && !e.shiftKey && !mod) {
      e.preventDefault();
      if (value !== block.content) await update(block.id, value);
      await insertSibling(block.id, "");
    } else if (e.key === "Backspace" && value === "") {
      e.preventDefault();
      await del(block.id);
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (value !== block.content) await update(block.id, value);
      if (e.shiftKey) await outdent(block.id);
      else await indent(block.id);
    } else if (mod && e.key === "Enter") {
      e.preventDefault();
      if (value !== block.content) await update(block.id, value);
      await cycleTask(block.id);
    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      if (value !== block.content) await update(block.id, value);
      if (e.key === "ArrowUp") await moveUp(block.id);
      else await moveDown(block.id);
    } else if (mod && (e.key === "b" || e.key === "B")) {
      e.preventDefault();
      wrapSelection("**");
    } else if (mod && (e.key === "i" || e.key === "I")) {
      e.preventDefault();
      wrapSelection("*");
    } else if (mod && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      wrapSelection("[[", "]]");
    } else if (mod && (e.key === "`")) {
      e.preventDefault();
      wrapSelection("`");
    }
  };

  // --- Drag and drop ---
  const onDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.setData("application/x-logseq-block", block.id);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = (e: React.DragEvent) => {
    const srcId = e.dataTransfer.types.includes("application/x-logseq-block")
      ? "pending"
      : null;
    if (!srcId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const row = rowRef.current;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const third = rect.height / 3;
    let pos: DropPos = "before";
    if (y > rect.height - third) pos = "after";
    else if (y > third) pos = "child";
    setDropPos(pos);
  };

  const onDragLeave = () => setDropPos(null);

  const onDrop = async (e: React.DragEvent) => {
    const srcId = e.dataTransfer.getData("application/x-logseq-block");
    const pos = dropPos;
    setDropPos(null);
    if (!srcId || srcId === block.id || !pos) return;
    e.preventDefault();
    e.stopPropagation();

    if (pos === "child") {
      // Append as first child.
      await moveBlockTo(srcId, block.id, 0);
      return;
    }

    const sameParent = blocks
      .filter((b) => b.parent_id === block.parent_id)
      .sort((a, b) => a.order - b.order);
    const targetIdx = sameParent.findIndex((b) => b.id === block.id);
    if (targetIdx < 0) return;
    // Compute a stable order value among siblings.
    const newOrder =
      pos === "before"
        ? block.order
        : (sameParent[targetIdx + 1]?.order ?? block.order + 1) - 0.5;
    await moveBlockTo(srcId, block.parent_id, newOrder);
  };

  const closed = block.task_marker === "DONE" || block.task_marker === "CANCELLED";
  const dropCls =
    dropPos === "before"
      ? " drop-before"
      : dropPos === "after"
        ? " drop-after"
        : dropPos === "child"
          ? " drop-child"
          : "";

  return (
    <div
      ref={rowRef}
      className={`block-row${dropCls}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className="block-bullet"
        draggable
        onDragStart={onDragStart}
        title="拖动以重新排序"
        aria-label="拖拽手柄"
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="block-line">
          <TaskMarkerPill blockId={block.id} marker={block.task_marker} />
          <div className="block-editor-stack">
            <textarea
              ref={ref}
              className={`block-editor${closed ? " block-editor-closed" : ""}${focused ? " is-focused" : " is-blurred"}`}
              rows={1}
              value={value}
              onChange={(e) => {
                const next = e.target.value;
                setValue(next);
                if (collabActive) syncToY(next);
              }}
              onBlur={() => {
                setFocused(false);
                onBlur();
                if (collabActive) {
                  setLocalPresence({ blockId: null, anchor: null, head: null });
                }
              }}
              onFocus={() => {
                setFocused(true);
                if (!collabActive) return;
                const el = ref.current;
                setLocalPresence({
                  blockId: block.id,
                  anchor: el?.selectionStart ?? null,
                  head: el?.selectionEnd ?? null,
                });
              }}
              onSelect={() => {
                if (!collabActive) return;
                const el = ref.current;
                if (!el) return;
                setLocalPresence({
                  blockId: block.id,
                  anchor: el.selectionStart,
                  head: el.selectionEnd,
                });
              }}
              onKeyDown={onKeyDown}
              placeholder=" "
              spellCheck={spellcheck}
            />
            {!focused && value.trim().length > 0 && (
              <div
                className="block-preview"
                onClick={(e) => {
                  // 点击预览中非链接区域 -> 聚焦 textarea；
                  // 链接元素自身已 stopPropagation 不会到这里。
                  const tag = (e.target as HTMLElement).tagName;
                  if (tag === "A") return;
                  ref.current?.focus();
                }}
              >
                <InlineRefs content={value} />
              </div>
            )}
          </div>
          {collabActive && (
            <span className="block-presence" aria-label="正在编辑此块的协作者">
              {peers
                .filter((p) => p.blockId === block.id)
                .map((p) => (
                  <span
                    key={p.clientId}
                    className="block-presence-dot"
                    style={{ background: p.color }}
                    title={p.name}
                  >
                    {p.name.slice(0, 1).toUpperCase()}
                  </span>
                ))}
            </span>
          )}
          <button
            type="button"
            className="block-history-btn"
            title="查看编辑历史"
            aria-label="查看编辑历史"
            onClick={(e) => {
              e.preventDefault();
              openHistory(block.id);
            }}
          >
            ⟲
          </button>
          {(() => {
            const list = commentsForBlock ?? [];
            const openCnt = list.filter((c) => !c.resolved).length;
            const total = list.length;
            if (total === 0) {
              return (
                <button
                  type="button"
                  className="block-comment-btn"
                  title="添加评论"
                  aria-label="添加评论"
                  onClick={(e) => {
                    e.preventDefault();
                    void openComments(block.id);
                  }}
                >
                  💬
                </button>
              );
            }
            return (
              <button
                type="button"
                className={`block-comment-btn block-comment-btn-active${
                  openCnt === 0 ? " block-comment-btn-resolved" : ""
                }`}
                title={`${openCnt} 未处理 / 共 ${total} 条评论`}
                aria-label="打开评论"
                onClick={(e) => {
                  e.preventDefault();
                  void openComments(block.id);
                }}
              >
                💬 {openCnt > 0 ? openCnt : total}
              </button>
            );
          })()}
        </div>
        <div className="block-meta">
          {block.scheduled && (
            <span className="date-pill date-scheduled">📅 {block.scheduled}</span>
          )}
          {block.deadline && (
            <span className="date-pill date-deadline">⏰ {block.deadline}</span>
          )}
        </div>
        {extractQueries(block.content).map((q, i) => (
          <QueryEmbed key={`${block.id}-q-${i}`} query={q} />
        ))}
        {block.refs_blocks.length > 0 && (
          <div className="block-embed-list">
            {block.refs_blocks.map((id) => (
              <BlockEmbed key={`${block.id}-embed-${id}`} blockId={id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
