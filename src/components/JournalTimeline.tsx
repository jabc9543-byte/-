import { useEffect, useState } from "react";
import { api } from "../api";
import type { Page } from "../types";
import { usePageStore } from "../stores/page";
import { useWhiteboardStore } from "../stores/whiteboard";

function formatJournalDay(day: number | null): string {
  if (!day) return "";
  const y = Math.floor(day / 10000);
  const m = Math.floor((day % 10000) / 100);
  const d = day % 100;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function JournalTimeline() {
  const [journals, setJournals] = useState<Page[]>([]);
  const activeId = usePageStore((s) => s.activePageId);
  const openPage = usePageStore((s) => s.openPage);
  const openToday = usePageStore((s) => s.openToday);
  const pages = usePageStore((s) => s.pages);
  const showPage = useWhiteboardStore((s) => s.showPage);
  const view = useWhiteboardStore((s) => s.view);

  useEffect(() => {
    api.listJournals().then(setJournals);
  }, [pages]);

  const onOpen = (id: string) => {
    showPage();
    openPage(id);
  };

  const onToday = () => {
    showPage();
    openToday();
  };

  const pageActive = view.kind === "page";

  return (
    <div className="timeline">
      <div className="timeline-header">
        <span>日志</span>
        <button className="timeline-today" onClick={onToday} title="打开今日日志">
          今日
        </button>
      </div>
      <ul className="timeline-list">
        {journals.length === 0 && (
          <li className="timeline-empty">尚无日志页面。</li>
        )}
        {journals.map((p) => (
          <li key={p.id}>
            <button
              className={pageActive && p.id === activeId ? "active" : ""}
              onClick={() => onOpen(p.id)}
            >
              {formatJournalDay(p.journal_day)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
