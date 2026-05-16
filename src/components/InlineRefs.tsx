import { useEffect, useState, type CSSProperties } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { usePageStore } from "../stores/page";
import { api } from "../api";
import { AssetMedia } from "./AssetMedia";

/**
 * 共享的 Logseq 风格行内渲染器：
 * - `[[页面名]]`  —— 点击跳转或新建页面
 * - `#标签`       —— 点击作为标签搜索（在搜索面板里筛选）
 * - `((blockId))` —— 点击跳转到目标块所在页面并滚动定位
 * - `**粗体**`、`*斜体*`、`` `代码` ``
 *
 * 渲染顺序保证不冲突：标签的 `#` 必须在行首或空白后；页面/块引用是显式分隔的成对符号。
 */
export function InlineRefs({
  content,
  style,
}: {
  content: string;
  style?: CSSProperties;
}) {
  if (!content) return null;
  return <span style={style}>{renderInlineRefs(content)}</span>;
}

interface Token {
  /** 起点（含），原文偏移量。 */
  start: number;
  end: number;
  kind: "page" | "tag" | "block" | "bold" | "italic" | "code" | "media" | "math-block" | "math-inline" | "link";
  value: string;
  /** Optional secondary value (alt text for media, href for link). */
  alt?: string;
}

export interface InlineMediaRef {
  src: string;
  alt?: string;
}

/** 扫描所有 token 并按顺序返回；token 互不重叠。 */
function tokenize(content: string): Token[] {
  const tokens: Token[] = [];
  // 注意：先 media、page、block，再 tag/bold/italic/code，避免 #tag 误吃到 [[#x]] 内部。
  const re =
    /\$\$([\s\S]+?)\$\$|(?<!\\)\$([^$\n]+?)\$|!\[([^\]\n]*)\]\(([^)\s]+)\)|\[([^\[\]\n]+?)\]\((https?:\/\/[^)\s]+)\)|\[\[([^\[\]\n]+?)\]\]|\(\(([A-Za-z0-9_\-]{6,})\)\)|(?:^|\s)#([\p{L}\p{N}_\-/]+)|\*\*([^*\n]+?)\*\*|(?<!\*)\*([^*\n]+?)\*(?!\*)|`([^`\n]+?)`/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const full = m[0];
    const start = m.index;
    const end = start + full.length;
    if (m[1] !== undefined) {
      tokens.push({ start, end, kind: "math-block", value: m[1] });
    } else if (m[2] !== undefined) {
      tokens.push({ start, end, kind: "math-inline", value: m[2] });
    } else if (m[3] !== undefined && m[4] !== undefined) {
      tokens.push({ start, end, kind: "media", value: m[4], alt: m[3] });
    } else if (m[5] !== undefined && m[6] !== undefined) {
      tokens.push({ start, end, kind: "link", value: m[5], alt: m[6] });
    } else if (m[7] !== undefined) {
      tokens.push({ start, end, kind: "page", value: m[7].trim() });
    } else if (m[8] !== undefined) {
      tokens.push({ start, end, kind: "block", value: m[8] });
    } else if (m[9] !== undefined) {
      // 把前置空白排除在 token 之外
      const tagStart = full.startsWith("#") ? start : start + 1;
      tokens.push({ start: tagStart, end, kind: "tag", value: m[9] });
    } else if (m[10] !== undefined) {
      tokens.push({ start, end, kind: "bold", value: m[10] });
    } else if (m[11] !== undefined) {
      tokens.push({ start, end, kind: "italic", value: m[11] });
    } else if (m[12] !== undefined) {
      tokens.push({ start, end, kind: "code", value: m[12] });
    }
  }
  return tokens;
}

export function extractInlineMedia(content: string): InlineMediaRef[] {
  return tokenize(content)
    .filter((t) => t.kind === "media")
    .map((t) => ({ src: t.value, alt: t.alt }));
}

export function stripInlineMedia(content: string): string {
  const tokens = tokenize(content).filter((t) => t.kind === "media");
  if (tokens.length === 0) return content;
  let out = "";
  let cursor = 0;
  for (const t of tokens) {
    out += content.slice(cursor, t.start);
    cursor = t.end;
  }
  out += content.slice(cursor);
  return out
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function renderInlineRefs(content: string) {
  const tokens = tokenize(content);
  const out: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const t of tokens) {
    if (t.start > cursor) out.push(content.slice(cursor, t.start));
    switch (t.kind) {
      case "page":
        out.push(<PageLink key={key++} name={t.value} />);
        break;
      case "tag":
        out.push(<TagLink key={key++} tag={t.value} />);
        break;
      case "block":
        out.push(<BlockRefLink key={key++} blockId={t.value} />);
        break;
      case "bold":
        out.push(<strong key={key++}>{t.value}</strong>);
        break;
      case "italic":
        out.push(<em key={key++}>{t.value}</em>);
        break;
      case "code":
        out.push(<code key={key++} className="inline-code">{t.value}</code>);
        break;
      case "media":
        out.push(<AssetMedia key={key++} src={t.value} alt={t.alt} />);
        break;
      case "math-block":
        out.push(<MathRender key={key++} tex={t.value} display />);
        break;
      case "math-inline":
        out.push(<MathRender key={key++} tex={t.value} />);
        break;
      case "link":
        out.push(
          <a
            key={key++}
            href={t.alt}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
          >
            {t.value}
          </a>,
        );
        break;
    }
    cursor = t.end;
  }
  if (cursor < content.length) out.push(content.slice(cursor));
  return out;
}

function PageLink({ name }: { name: string }) {
  const openByName = usePageStore((s) => s.openByName);
  return (
    <a
      className="page-link"
      title={`打开页面 ${name}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openByName(name).catch(() => {});
      }}
    >
      [[{name}]]
    </a>
  );
}

function TagLink({ tag }: { tag: string }) {
  const openByName = usePageStore((s) => s.openByName);
  return (
    <a
      className="tag tag-link"
      title={`打开标签页面 ${tag}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // Logseq 把 #标签 视为一个普通页面，名字就是标签本身。
        openByName(tag).catch(() => {});
      }}
    >
      #{tag}
    </a>
  );
}

function BlockRefLink({ blockId }: { blockId: string }) {
  const openPage = usePageStore((s) => s.openPage);
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getBlock(blockId)
      .then((b) => {
        if (alive && b) {
          const first = b.content.split("\n", 1)[0] ?? "";
          setLabel(first.slice(0, 60) || `((${blockId.slice(0, 6)}…))`);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [blockId]);

  return (
    <a
      className="block-ref"
      title={`跳转到块 ${blockId}`}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          const block = await api.getBlock(blockId);
          if (!block) return;
          await openPage(block.page_id);
          // 等下一帧再滚动，确保 DOM 更新完毕
          window.requestAnimationFrame(() => {
            const el = document.querySelector(
              `[data-block-id="${CSS.escape(blockId)}"]`,
            ) as HTMLElement | null;
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              el.classList.add("toc-flash");
              window.setTimeout(() => el.classList.remove("toc-flash"), 1200);
            }
          });
        } catch {
          // ignore
        }
      }}
    >
      {label ? (
        <>(({label}))</>
      ) : (
        <>(({blockId.slice(0, 6)}…))</>
      )}
    </a>
  );
}

function MathRender({ tex, display }: { tex: string; display?: boolean }) {
  let html = "";
  try {
    html = katex.renderToString(tex, {
      displayMode: !!display,
      throwOnError: false,
      output: "html",
      strict: "ignore",
    });
  } catch (e) {
    return (
      <code className="math-error" title={String(e)}>
        {display ? `$$${tex}$$` : `$${tex}$`}
      </code>
    );
  }
  if (display) {
    return (
      <span
        className="math math-display"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <span
      className="math math-inline"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
