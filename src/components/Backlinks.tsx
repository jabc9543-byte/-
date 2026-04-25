import { useEffect, useState } from "react";
import { api } from "../api";
import type { Block } from "../types";
import { usePageStore } from "../stores/page";
import { InlineRefs } from "./InlineRefs";

interface Props {
  pageName: string;
}

export function Backlinks({ pageName }: Props) {
  const [hits, setHits] = useState<Block[]>([]);
  const openPage = usePageStore((s) => s.openPage);
  const pages = usePageStore((s) => s.pages);

  useEffect(() => {
    let cancelled = false;
    api.backlinks(pageName).then((r) => {
      if (!cancelled) setHits(r);
    });
    return () => {
      cancelled = true;
    };
  }, [pageName]);

  if (hits.length === 0) return null;

  return (
    <section className="backlinks">
      <h2>反向链接（{hits.length}）</h2>
      {hits.map((b) => {
        const sourcePage = pages.find((p) => p.id === b.page_id);
        const label = sourcePage?.name ?? b.page_id;
        return (
          <div key={b.id} className="hit">
            <div className="source">
              <a
                className="page-link"
                title={`打开页面 ${label}`}
                onClick={() => openPage(b.page_id)}
              >
                {label}
              </a>
            </div>
            <div className="hit-content">
              <InlineRefs content={b.content} />
            </div>
          </div>
        );
      })}
    </section>
  );
}
