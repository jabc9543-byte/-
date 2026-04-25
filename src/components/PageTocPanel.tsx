import { useMemo } from "react";
import { usePageStore } from "../stores/page";
import type { Block } from "../types";

interface Heading {
  id: string;
  level: number;
  text: string;
}

/** 从块内容中提取 Markdown 标题（# 到 ######）。 */
function extractHeadings(blocks: Block[]): Heading[] {
  const headings: Heading[] = [];
  for (const b of blocks) {
    const firstLine = b.content.split("\n", 1)[0] ?? "";
    const m = firstLine.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) {
      headings.push({
        id: b.id,
        level: m[1].length,
        text: m[2].trim(),
      });
    }
  }
  return headings;
}

function scrollToBlock(id: string) {
  const el = document.querySelector(
    `[data-block-id="${CSS.escape(id)}"]`,
  ) as HTMLElement | null;
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("toc-flash");
    window.setTimeout(() => el.classList.remove("toc-flash"), 1200);
  }
}

export function PageTocPanel() {
  const blocks = usePageStore((s) => s.blocks);
  const page = usePageStore((s) => s.page);
  const headings = useMemo(() => extractHeadings(blocks), [blocks]);

  if (!page || headings.length === 0) return null;

  const minLevel = Math.min(...headings.map((h) => h.level));

  return (
    <aside className="page-toc" aria-label="页面目录">
      <div className="page-toc-title">目录</div>
      <ul>
        {headings.map((h) => (
          <li
            key={h.id}
            style={{ paddingLeft: (h.level - minLevel) * 12 }}
          >
            <button
              className={`toc-link toc-h${h.level}`}
              onClick={() => scrollToBlock(h.id)}
              title={h.text}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
