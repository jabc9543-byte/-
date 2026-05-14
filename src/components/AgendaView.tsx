import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { AgendaItem, TaskMarker } from "../types";
import { usePageStore } from "../stores/page";
import { useWhiteboardStore } from "../stores/whiteboard";

type Bucket =
  | "overdue"
  | "today"
  | "tomorrow"
  | "week"
  | "later"
  | "no_date"
  | "done";

const BUCKET_ORDER: Bucket[] = [
  "overdue",
  "today",
  "tomorrow",
  "week",
  "later",
  "no_date",
  "done",
];

const BUCKET_LABELS: Record<Bucket, string> = {
  overdue: "已逾期",
  today: "今日",
  tomorrow: "明天",
  week: "未来 7 天",
  later: "稍后",
  no_date: "无日期",
  done: "近期完成",
};

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + "T00:00:00");
  const b = new Date(bIso + "T00:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function bucketOf(item: AgendaItem, today: string, horizon: number): Bucket {
  if (item.closed) return "done";
  if (!item.iso_date) return "no_date";
  const diff = daysBetween(today, item.iso_date);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff <= horizon) return "week";
  return "later";
}

const CYCLE_NEXT: Record<TaskMarker, TaskMarker | null> = {
  TODO: "DOING",
  DOING: "DONE",
  DONE: "TODO",
  LATER: "NOW",
  NOW: "DONE",
  WAITING: "DONE",
  CANCELLED: "TODO",
};

function stripMarker(content: string): string {
  return content.replace(
    /^(TODO|DOING|DONE|LATER|NOW|WAITING|CANCELLED)\s+/,
    "",
  );
}

function firstLine(content: string): string {
  const l = content.split("\n")[0] ?? "";
  return stripMarker(l).trim() || "（空）";
}

export function AgendaView() {
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<number>(7);
  const [completedDays, setCompletedDays] = useState<number>(7);
  const [today, setToday] = useState<string>(todayIso());

  const showPage = useWhiteboardStore((s) => s.showPage);
  const openByName = usePageStore((s) => s.openByName);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.agenda(completedDays);
      setItems(rows);
      setToday(todayIso());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [completedDays]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-fetch whenever a plugin (or the editor) reports that data changed
  // so newly inserted TODO blocks show up without needing the manual
  // "刷新" button.
  useEffect(() => {
    const handler = () => {
      refresh().catch(() => {});
    };
    window.addEventListener("quanshiwei:data-changed", handler);
    return () => window.removeEventListener("quanshiwei:data-changed", handler);
  }, [refresh]);

  const grouped = useMemo(() => {
    const map: Record<Bucket, AgendaItem[]> = {
      overdue: [],
      today: [],
      tomorrow: [],
      week: [],
      later: [],
      no_date: [],
      done: [],
    };
    for (const it of items) {
      map[bucketOf(it, today, horizon)].push(it);
    }
    for (const k of BUCKET_ORDER) {
      map[k].sort((a, b) => {
        const ad = a.iso_date ?? "9999-99-99";
        const bd = b.iso_date ?? "9999-99-99";
        if (ad !== bd) return ad < bd ? -1 : 1;
        if (a.kind !== b.kind) {
          // deadline ranks before scheduled on the same day
          return a.kind === "deadline" ? -1 : 1;
        }
        return a.block.content.localeCompare(b.block.content);
      });
    }
    return map;
  }, [items, today, horizon]);

  const totalOpen = useMemo(
    () => items.filter((i) => !i.closed).length,
    [items],
  );

  const cycle = async (id: string) => {
    try {
      await api.cycleTask(id);
      await refresh();
    } catch (e) {
      console.error("[agenda] cycle failed", e);
    }
  };

  const setMarker = async (id: string, marker: TaskMarker | null) => {
    try {
      await api.setTask(id, marker);
      await refresh();
    } catch (e) {
      console.error("[agenda] setTask failed", e);
    }
  };

  const openPageFor = async (name: string) => {
    if (!name) return;
    showPage();
    try {
      await openByName(name);
    } catch (e) {
      console.error("[agenda] open page failed", e);
    }
  };

  return (
    <div className="agenda-view">
      <header className="agenda-header">
        <div className="agenda-title">
          <h2>日程</h2>
          <span className="agenda-count">{totalOpen} 项待办</span>
        </div>
        <div className="agenda-controls">
          <label>
            时间窗
            <select
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
            >
              <option value={3}>3 天</option>
              <option value={7}>7 天</option>
              <option value={14}>14 天</option>
              <option value={30}>30 天</option>
            </select>
          </label>
          <label>
            已完成范围
            <select
              value={completedDays}
              onChange={(e) => setCompletedDays(Number(e.target.value))}
            >
              <option value={0}>不显示</option>
              <option value={1}>1 天</option>
              <option value={3}>3 天</option>
              <option value={7}>7 天</option>
              <option value={30}>30 天</option>
            </select>
          </label>
          <button onClick={refresh} disabled={loading}>
            {loading ? "…" : "刷新"}
          </button>
        </div>
      </header>

      {error && <div className="agenda-error">{error}</div>}

      <div className="agenda-sections">
        {BUCKET_ORDER.map((bucket) => {
          const rows = grouped[bucket];
          if (rows.length === 0) return null;
          return (
            <section
              key={bucket}
              className={`agenda-section agenda-section-${bucket}`}
            >
              <h3 className="agenda-section-title">
                {BUCKET_LABELS[bucket]}
                <span className="agenda-section-count">{rows.length}</span>
              </h3>
              <ul className="agenda-list">
                {rows.map((item, idx) => {
                  const marker = item.block.task_marker;
                  const dayLabel = item.iso_date ?? "";
                  const diff = item.iso_date
                    ? daysBetween(today, item.iso_date)
                    : null;
                  return (
                    <li
                      key={`${item.block.id}-${item.kind}-${idx}`}
                      className={[
                        "agenda-item",
                        bucket === "overdue" ? "overdue" : "",
                        item.closed ? "closed" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <button
                        className={`agenda-marker marker-${marker ?? "none"}`}
                        title={
                          marker
                            ? `切换（下一个：${CYCLE_NEXT[marker] ?? "TODO"}）`
                            : "添加 TODO"
                        }
                        onClick={() => cycle(item.block.id)}
                      >
                        {marker ?? "·"}
                      </button>
                      <div className="agenda-item-body">
                        <div className="agenda-item-content">
                          {firstLine(item.block.content)}
                        </div>
                        <div className="agenda-item-meta">
                          {item.iso_date && (
                            <span
                              className={`agenda-day-chip kind-${item.kind}`}
                              title={
                                item.kind === "deadline"
                                  ? "截止日"
                                  : "计划日"
                              }
                            >
                              {item.kind === "deadline" ? "! " : ""}
                              {dayLabel}
                              {diff !== null && diff !== 0 && (
                                <span className="agenda-day-rel">
                                  {diff > 0
                                    ? ` (+${diff} 天)`
                                    : ` (${diff} 天)`}
                                </span>
                              )}
                            </span>
                          )}
                          {item.page_name && (
                            <button
                              className="agenda-page-chip"
                              onClick={() => openPageFor(item.page_name)}
                              title="打开页面"
                            >
                              {item.page_name}
                            </button>
                          )}
                          {!item.closed && marker && (
                            <button
                              className="agenda-done-btn"
                              onClick={() => setMarker(item.block.id, "DONE")}
                              title="标记为 DONE"
                            >
                              ✓
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {items.length === 0 && !loading && (
          <div className="agenda-empty">暂无任务。轻松一下吧。</div>
        )}
      </div>
    </div>
  );
}
