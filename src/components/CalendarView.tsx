import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { Block, CalendarCell } from "../types";
import { usePageStore } from "../stores/page";
import { useWhiteboardStore } from "../stores/whiteboard";

// ymd helpers -----------------------------------------------------------
function ymdOf(y: number, m1: number, d: number): number {
  return y * 10000 + m1 * 100 + d;
}
function daysInMonth(y: number, m1: number): number {
  return new Date(y, m1, 0).getDate();
}
function todayYmd(): number {
  const t = new Date();
  return ymdOf(t.getFullYear(), t.getMonth() + 1, t.getDate());
}
function ymdToLabel(ymd: number): string {
  const y = Math.floor(ymd / 10000);
  const m = Math.floor((ymd % 10000) / 100);
  const d = ymd % 100;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const WEEK_DAYS = ["一", "二", "三", "四", "五", "六", "日"];
const MONTH_NAMES = [
  "1 月", "2 月", "3 月", "4 月", "5 月", "6 月",
  "7 月", "8 月", "9 月", "10 月", "11 月", "12 月",
];

export function CalendarView() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [cells, setCells] = useState<Map<number, CalendarCell>>(new Map());
  const [selected, setSelected] = useState<number>(todayYmd());
  const [dayBlocks, setDayBlocks] = useState<Block[]>([]);
  const [loadingDay, setLoadingDay] = useState(false);

  const showPage = useWhiteboardStore((s) => s.showPage);
  const openPage = usePageStore((s) => s.openPage);

  const rangeStart = ymdOf(year, month, 1);
  const rangeEnd = ymdOf(year, month, daysInMonth(year, month));

  const loadMonth = useCallback(async () => {
    try {
      const list = await api.calendarSummary(rangeStart, rangeEnd);
      const map = new Map<number, CalendarCell>();
      for (const c of list) map.set(c.ymd, c);
      setCells(map);
    } catch (e) {
      console.error("[calendar] summary failed", e);
    }
  }, [rangeStart, rangeEnd]);

  useEffect(() => {
    loadMonth();
  }, [loadMonth]);

  useEffect(() => {
    let cancelled = false;
    setLoadingDay(true);
    api
      .blocksForDate(selected)
      .then((bs) => {
        if (!cancelled) setDayBlocks(bs);
      })
      .catch(() => {
        if (!cancelled) setDayBlocks([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingDay(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const gridDays = useMemo(() => {
    // Build a 6-row Monday-first grid covering the month with leading/trailing padding.
    const first = new Date(year, month - 1, 1);
    const offset = (first.getDay() + 6) % 7; // Monday=0
    const dim = daysInMonth(year, month);
    const cells: { ymd: number; inMonth: boolean }[] = [];
    // Leading days from previous month
    const prev = new Date(year, month - 2, 1);
    const prevDim = daysInMonth(prev.getFullYear(), prev.getMonth() + 1);
    for (let i = offset - 1; i >= 0; i--) {
      const d = prevDim - i;
      cells.push({
        ymd: ymdOf(prev.getFullYear(), prev.getMonth() + 1, d),
        inMonth: false,
      });
    }
    for (let d = 1; d <= dim; d++) {
      cells.push({ ymd: ymdOf(year, month, d), inMonth: true });
    }
    // Trailing to 42 slots
    const next = new Date(year, month, 1);
    let d = 1;
    while (cells.length < 42) {
      cells.push({
        ymd: ymdOf(next.getFullYear(), next.getMonth() + 1, d),
        inMonth: false,
      });
      d++;
    }
    return cells;
  }, [year, month]);

  const go = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  const jumpToToday = () => {
    const t = new Date();
    setYear(t.getFullYear());
    setMonth(t.getMonth() + 1);
    setSelected(todayYmd());
  };

  const openJournal = async (ymd: number) => {
    try {
      const page = await api.journalForDate(ymd);
      showPage();
      await openPage(page.id);
    } catch (e) {
      console.error("[calendar] open journal failed", e);
    }
  };

  const todayYmdVal = todayYmd();
  const selectedCell = cells.get(selected);

  return (
    <div className="calendar-view">
      <header className="calendar-header">
        <div className="calendar-title">
          <h2>
            {year} 年 {MONTH_NAMES[month - 1]}
          </h2>
        </div>
        <div className="calendar-nav">
          <button onClick={() => go(-12)} title="上一年">« 年</button>
          <button onClick={() => go(-1)} title="上个月">‹ 月</button>
          <button onClick={jumpToToday}>今日</button>
          <button onClick={() => go(1)} title="下个月">月 ›</button>
          <button onClick={() => go(12)} title="下一年">年 »</button>
        </div>
      </header>

      <div className="calendar-grid" role="grid" aria-label="日历">
        {WEEK_DAYS.map((d) => (
          <div key={d} className="calendar-weekday">{d}</div>
        ))}
        {gridDays.map(({ ymd, inMonth }) => {
          const info = cells.get(ymd);
          const day = ymd % 100;
          const isToday = ymd === todayYmdVal;
          const isSelected = ymd === selected;
          const hasAnything =
            info && (info.journal || info.scheduled > 0 || info.deadline > 0);
          return (
            <button
              key={ymd}
              className={[
                "calendar-cell",
                inMonth ? "" : "calendar-cell-outside",
                isToday ? "calendar-cell-today" : "",
                isSelected ? "calendar-cell-selected" : "",
                hasAnything ? "calendar-cell-has" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => setSelected(ymd)}
              onDoubleClick={() => openJournal(ymd)}
              title={
                info
                  ? [
                      info.journal ? "存在日志" : "",
                      info.scheduled > 0 ? `${info.scheduled} 项计划` : "",
                      info.deadline > 0 ? `${info.deadline} 项截止` : "",
                    ].filter(Boolean).join(" · ")
                  : "双击创建或打开日志"
              }
            >
              <span className="calendar-day">{day}</span>
              <span className="calendar-badges">
                {info?.journal && <span className="calendar-badge badge-journal">J</span>}
                {info && info.scheduled > 0 && (
                  <span className="calendar-badge badge-sched">
                    {info.scheduled}
                  </span>
                )}
                {info && info.deadline > 0 && (
                  <span className="calendar-badge badge-dead">
                    !{info.deadline}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <aside className="calendar-detail">
        <header>
          <h3>{ymdToLabel(selected)}</h3>
          <button className="calendar-open" onClick={() => openJournal(selected)}>
            {selectedCell?.journal ? "打开日志" : "创建日志"}
          </button>
        </header>
        {loadingDay ? (
          <div className="calendar-empty">加载中…</div>
        ) : dayBlocks.length === 0 ? (
          <div className="calendar-empty">该日无计划或截止事项。</div>
        ) : (
          <ul className="calendar-day-list">
            {dayBlocks.map((b) => (
              <li
                key={b.id}
                className={`calendar-item ${
                  b.deadline === ymdToLabel(selected) ? "is-deadline" : "is-scheduled"
                }`}
                onClick={() => openPage(b.page_id)}
              >
                <span className="calendar-item-marker">
                  {b.deadline === ymdToLabel(selected) ? "⏰" : "📅"}
                </span>
                <div className="calendar-item-body">
                  <div className="calendar-item-page">{b.page_id}</div>
                  <div className="calendar-item-text">
                    {b.content.split("\n")[0] || <em>（空）</em>}
                  </div>
                </div>
                {b.task_marker && (
                  <span className={`calendar-item-task task-${b.task_marker.toLowerCase()}`}>
                    {b.task_marker}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
