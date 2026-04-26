import { memo, useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import type { Block } from "../types";
import { usePageStore } from "../stores/page";
import { useSettingsStore } from "../stores/settings";
import { useCollabStore } from "../stores/collab";
import { useHistoryPanelStore } from "../stores/history";
import { useCommentsStore } from "../stores/comments";
import { useIsTouch } from "../hooks/useMediaQuery";
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
  return <BlockRowInner block={block} />;
}

function BlockRowImpl({ block }: Props) {
  const update = usePageStore((s) => s.updateBlock);
  const insertSibling = usePageStore((s) => s.insertSibling);
  const del = usePageStore((s) => s.deleteBlock);
  const indent = usePageStore((s) => s.indent);
  const outdent = usePageStore((s) => s.outdent);
  const cycleTask = usePageStore((s) => s.cycleTask);
  const moveBlockTo = usePageStore((s) => s.moveBlockTo);
  const moveUp = usePageStore((s) => s.moveBlockUp);
  const moveDown = usePageStore((s) => s.moveBlockDown);
  // NOTE: deliberately NOT subscribing the entire `blocks` array — that
  // caused BlockRow to re-render on every collab/file-watcher tick,
  // which on Android WebView can drop the active IME connection. Read
  // it lazily inside onDrop via getState() instead.
  const spellcheck = useSettingsStore((s) => s.spellcheck);
  const openHistory = useHistoryPanelStore((s) => s.open);
  const openComments = useCommentsStore((s) => s.openPanel);
  const commentsForBlock = useCommentsStore((s) => s.byBlock[block.id]);
  const isTouch = useIsTouch();

  const ref = useRef<HTMLTextAreaElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(block.content);
  const [dropPos, setDropPos] = useState<DropPos>(null);
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  // Track IME composition. React's controlled <textarea> rewrites the
  // DOM value on each onChange, which on Android breaks an in-flight
  // composition and dismisses the soft keyboard. Suspend setValue while
  // composing and reconcile on compositionend.
  const composingRef = useRef(false);

  // --- Collaborative editing binding ---
  const collabStatus = useCollabStore((s) => s.status);
  const collabActive = collabStatus === "connected" || collabStatus === "connecting";
  const getOrCreateText = useCollabStore((s) => s.getOrCreateText);
  const markDirty = useCollabStore((s) => s.markDirty);
  const setLocalPresence = useCollabStore((s) => s.setLocalPresence);
  // peers subscription moved to <PresenceChip> child component so a
  // collab awareness update doesn't re-render every BlockRow.
  const ytextRef = useRef<Y.Text | null>(null);
  const applyingRemote = useRef(false);

  useEffect(() => {
    // Don't clobber in-progress edits while the textarea is focused —
    // backend reload / file-watcher fires can otherwise reset the value
    // mid-typing, which on Android dismisses the soft keyboard.
    if (focusedRef.current) return;
    setValue(block.content);
    // Keep DOM in sync (the textarea is uncontrolled — see below).
    if (ref.current && ref.current.value !== block.content) {
      ref.current.value = block.content;
    }
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
        if (el.value !== next) el.value = next;
        setValue(next);
        requestAnimationFrame(() => {
          if (!ref.current) return;
          const len = next.length;
          ref.current.selectionStart = Math.min(start, len);
          ref.current.selectionEnd = Math.min(end, len);
          applyingRemote.current = false;
        });
      } else {
        if (el && el.value !== next) el.value = next;
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

  // Height is handled purely by CSS (field-sizing: content with a textarea
  // fallback via min-height). Doing JS-driven autoresize on every keystroke
  // forces a reflow that on Android cancels IME composition and dismisses
  // the soft keyboard. Only normalize height once on blur in case the
  // browser doesn't support field-sizing.
  const autoresizeOnBlur = () => {
    const el = ref.current;
    if (!el) return;
    if (CSS.supports?.("field-sizing", "content")) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  };

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
    // Don't intercept keys while an IME is composing (Chinese/Japanese
    // input methods send key=Enter etc. to confirm a candidate). Doing
    // preventDefault here on Android tears down the editor mid-compose
    // and the soft keyboard dismisses.
    // React types don't always include isComposing; read off nativeEvent.
    if ((e.nativeEvent as KeyboardEvent).isComposing || e.keyCode === 229) {
      return;
    }
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

    const sameParent = usePageStore
      .getState()
      .blocks
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
      onDragOver={isTouch ? undefined : onDragOver}
      onDragLeave={isTouch ? undefined : onDragLeave}
      onDrop={isTouch ? undefined : onDrop}
    >
      <div
        className="block-bullet"
        draggable={!isTouch}
        onDragStart={isTouch ? undefined : onDragStart}
        title="拖动以重新排序"
        aria-label="拖拽手柄"
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="block-line">
          <TaskMarkerPill blockId={block.id} marker={block.task_marker} />
          <div className="block-editor-stack">
            <textarea
              ref={ref}
              className={`block-editor${closed ? " block-editor-closed" : ""}${focused ? " is-focused" : " is-blurred"}${isTouch ? " is-touch" : ""}`}
              rows={isTouch ? 3 : 1}
              defaultValue={block.content}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={(e) => {
                composingRef.current = false;
                const next = (e.target as HTMLTextAreaElement).value;
                setValue(next);
                if (collabActive) syncToY(next);
              }}
              onChange={(e) => {
                const next = e.target.value;
                // While composing, let the browser show the IME preview
                // unchallenged. We'll sync the final value on
                // compositionend.
                if (composingRef.current) return;
                setValue(next);
                if (collabActive) syncToY(next);
              }}
              onBlur={() => {
                setFocused(false);
                focusedRef.current = false;
                autoresizeOnBlur();
                onBlur();
                if (collabActive) {
                  setLocalPresence({ blockId: null, anchor: null, head: null });
                }
              }}
              onFocus={() => {
                setFocused(true);
                focusedRef.current = true;
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
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              inputMode="text"
              enterKeyHint="enter"
              data-gramm="false"
              data-gramm_editor="false"
              data-enable-grammarly="false"
            />
            {!isTouch && !focused && value.trim().length > 0 && (
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
          {collabActive && <PresenceChip blockId={block.id} />}
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

// Memoized inner component. Only re-renders when the block prop's
// identity changes (page store mutates blocks via .map() so a content
// edit produces a new object). Crucially, awareness/peer ticks from
// the collab store do NOT subscribe here so they can't re-render the
// row while the user is typing on Android.
const BlockRowInner = memo(BlockRowImpl, (prev, next) => prev.block === next.block);

// Tiny subscriber for collab presence \u2014 isolated so a peer awareness
// update only re-renders this 16px chip, not the whole BlockRow.
function PresenceChip({ blockId }: { blockId: string }) {
  const peers = useCollabStore((s) => s.peers);
  const here = peers.filter((p) => p.blockId === blockId);
  if (here.length === 0) return null;
  return (
    <span className="block-presence" aria-label="正在编辑此块的协作者">
      {here.map((p) => (
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
  );
}
