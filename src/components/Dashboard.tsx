import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { DashboardStats } from "../types";
import { usePageStore } from "../stores/page";
import { useWhiteboardStore } from "../stores/whiteboard";

/**
 * Dashboard / chart widgets (module 25).
 *
 * Renders the output of `dashboard_stats` as a grid of small cards:
 *   * KPI tiles (pages, blocks, tasks, refs)
 *   * Task funnel (stacked horizontal bar, TODO→DONE proportions)
 *   * 30-day activity (SVG sparkline — blocks created + tasks completed)
 *   * Hot pages / hot tags top-10 lists
 *   * Upcoming SCHEDULED / DEADLINE counts
 */
export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const openPage = usePageStore((s) => s.openPage);
  const showPage = useWhiteboardStore((s) => s.showPage);

  const reload = async () => {
    setLoading(true);
    try {
      const s = await api.dashboardStats();
      setStats(s);
      setError(null);
      setLastRefresh(new Date());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  if (loading && !stats) {
    return (
      <div className="dashboard-loading">正在计算仪表盘…</div>
    );
  }
  if (error) {
    return (
      <div className="dashboard-error">
        <p>加载仪表盘失败：{error}</p>
        <button onClick={reload}>重试</button>
      </div>
    );
  }
  if (!stats) return null;

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>仪表盘</h1>
        <div className="dashboard-sub">
          <button onClick={reload} disabled={loading}>
            {loading ? "刷新中…" : "刷新"}
          </button>
          {lastRefresh && (
            <span className="dashboard-ts">
              更新于 {lastRefresh.toLocaleTimeString()}
            </span>
          )}
        </div>
      </header>

      <section className="dashboard-grid">
        <KpiCard label="页面" value={stats.overall.pages} hint={`${stats.overall.journal_pages} 日志`} />
        <KpiCard label="块" value={stats.overall.blocks} />
        <KpiCard
          label="待处理任务"
          value={stats.overall.tasks_open}
          hint={`${stats.overall.tasks_done} 已完成`}
        />
        <KpiCard
          label="引用"
          value={stats.overall.refs_total}
          hint={`${stats.overall.tags_total} 标签`}
        />
        <KpiCard
          label="截止日 · 7 天"
          value={stats.upcoming_deadlines}
          accent="danger"
        />
        <KpiCard
          label="计划 · 7 天"
          value={stats.upcoming_scheduled}
        />
      </section>

      <section className="dashboard-card">
        <h2>任务漏斗</h2>
        <TaskFunnelBar funnel={stats.task_funnel} />
      </section>

      <section className="dashboard-card">
        <h2>活跃度 · 最近 30 天</h2>
        <ActivityChart daily={stats.daily} />
      </section>

      <div className="dashboard-two-col">
        <section className="dashboard-card">
          <h2>热门页面</h2>
          {stats.hot_pages.length === 0 ? (
            <div className="dashboard-empty">尚无页面引用。</div>
          ) : (
            <ul className="dashboard-list">
              {stats.hot_pages.map((p) => (
                <li key={p.id}>
                  <a
                    className="page-link"
                    onClick={() => {
                      showPage();
                      openPage(p.id);
                    }}
                  >
                    {p.name}
                  </a>
                  {p.is_journal && (
                    <span className="dashboard-tag">日志</span>
                  )}
                  <span className="dashboard-count">{p.inbound}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dashboard-card">
          <h2>热门标签</h2>
          {stats.hot_tags.length === 0 ? (
            <div className="dashboard-empty">图谱中暂无标签。</div>
          ) : (
            <ul className="dashboard-list">
              {stats.hot_tags.map((t) => (
                <li key={t.tag}>
                  <span className="tag">#{t.tag}</span>
                  <span className="dashboard-count">{t.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

interface KpiProps {
  label: string;
  value: number;
  hint?: string;
  accent?: "danger" | "accent";
}

function KpiCard({ label, value, hint, accent }: KpiProps) {
  return (
    <div className={`dashboard-kpi ${accent ? `accent-${accent}` : ""}`}>
      <div className="dashboard-kpi-label">{label}</div>
      <div className="dashboard-kpi-value">{value.toLocaleString()}</div>
      {hint && <div className="dashboard-kpi-hint">{hint}</div>}
    </div>
  );
}

interface FunnelProps {
  funnel: DashboardStats["task_funnel"];
}

function TaskFunnelBar({ funnel }: FunnelProps) {
  const segments = useMemo(
    () => [
      { key: "todo", label: "TODO", value: funnel.todo, color: "#6b7280" },
      { key: "later", label: "LATER", value: funnel.later, color: "#94a3b8" },
      { key: "waiting", label: "WAITING", value: funnel.waiting, color: "#a78bfa" },
      { key: "doing", label: "DOING", value: funnel.doing, color: "#3b82f6" },
      { key: "now", label: "NOW", value: funnel.now, color: "#0ea5e9" },
      { key: "done", label: "DONE", value: funnel.done, color: "#10b981" },
      { key: "cancelled", label: "CANCELLED", value: funnel.cancelled, color: "#f87171" },
    ],
    [funnel],
  );
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) {
    return <div className="dashboard-empty">尚无任务 — 在块上添加 `TODO`。</div>;
  }
  return (
    <>
      <div className="dashboard-bar">
        {segments.map((s) =>
          s.value === 0 ? null : (
            <div
              key={s.key}
              className="dashboard-bar-seg"
              style={{
                width: `${(s.value / total) * 100}%`,
                background: s.color,
              }}
              title={`${s.label}: ${s.value}`}
            />
          ),
        )}
      </div>
      <ul className="dashboard-legend">
        {segments.map((s) => (
          <li key={s.key}>
            <span className="dot" style={{ background: s.color }} />
            <span className="dashboard-legend-label">{s.label}</span>
            <span className="dashboard-legend-value">{s.value}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

interface ActivityProps {
  daily: DashboardStats["daily"];
}

function ActivityChart({ daily }: ActivityProps) {
  const width = 720;
  const height = 160;
  const pad = { top: 12, right: 14, bottom: 22, left: 34 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const max = Math.max(
    1,
    ...daily.map((d) => Math.max(d.blocks_created, d.tasks_completed)),
  );
  const n = daily.length;
  const step = n > 1 ? innerW / (n - 1) : innerW;

  const point = (i: number, v: number) => ({
    x: pad.left + i * step,
    y: pad.top + innerH - (v / max) * innerH,
  });

  const path = (key: "blocks_created" | "tasks_completed") =>
    daily
      .map((d, i) => {
        const p = point(i, d[key]);
        return `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      })
      .join(" ");

  // Gridlines: 4 evenly spaced y-ticks.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => ({
    y: pad.top + innerH * (1 - p),
    value: Math.round(max * p),
  }));

  // X labels every 5 days.
  const xLabels = daily
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => i % 5 === 0 || i === n - 1);

  return (
    <>
      <svg
        className="dashboard-chart"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="30 天活跃度"
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={t.y}
              y2={t.y}
              stroke="var(--border)"
              strokeDasharray="2 3"
            />
            <text
              x={pad.left - 6}
              y={t.y + 3}
              textAnchor="end"
              fontSize="10"
              fill="var(--fg-muted)"
            >
              {t.value}
            </text>
          </g>
        ))}
        <path
          d={path("blocks_created")}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2"
        />
        <path
          d={path("tasks_completed")}
          fill="none"
          stroke="#10b981"
          strokeWidth="2"
        />
        {xLabels.map(({ d, i }) => (
          <text
            key={i}
            x={pad.left + i * step}
            y={height - 6}
            fontSize="10"
            fill="var(--fg-muted)"
            textAnchor="middle"
          >
            {d.date.slice(5)}
          </text>
        ))}
      </svg>
      <ul className="dashboard-legend">
        <li>
          <span className="dot" style={{ background: "#3b82f6" }} />
          <span className="dashboard-legend-label">新增块</span>
          <span className="dashboard-legend-value">
            {daily.reduce((s, d) => s + d.blocks_created, 0)}
          </span>
        </li>
        <li>
          <span className="dot" style={{ background: "#10b981" }} />
          <span className="dashboard-legend-label">完成任务</span>
          <span className="dashboard-legend-value">
            {daily.reduce((s, d) => s + d.tasks_completed, 0)}
          </span>
        </li>
      </ul>
    </>
  );
}
