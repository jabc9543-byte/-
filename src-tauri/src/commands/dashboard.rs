//! Dashboard aggregate stats (module 25).
//!
//! Lightweight analytics over the current graph to power the dashboard view.
//! Everything here is computed on-demand from the backend's block list; the
//! numbers are cheap enough (O(blocks)) that caching is unnecessary for
//! typical graph sizes.

use std::collections::{BTreeMap, HashMap};

use chrono::{Datelike, Duration, Local, NaiveDate};
use serde::Serialize;
use tauri::State;

use crate::error::AppResult;
use crate::model::TaskMarker;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct TaskFunnel {
    pub todo: usize,
    pub doing: usize,
    pub done: usize,
    pub later: usize,
    pub now: usize,
    pub waiting: usize,
    pub cancelled: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct DailyPoint {
    /// `YYYY-MM-DD`
    pub date: String,
    pub blocks_created: usize,
    pub tasks_completed: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct HotPage {
    pub id: String,
    pub name: String,
    pub inbound: usize,
    pub is_journal: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct HotTag {
    pub tag: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct OverallStats {
    pub pages: usize,
    pub journal_pages: usize,
    pub blocks: usize,
    pub tasks_open: usize,
    pub tasks_done: usize,
    pub tags_total: usize,
    pub refs_total: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct DashboardStats {
    pub overall: OverallStats,
    pub task_funnel: TaskFunnel,
    /// Last 30 days including today, oldest first.
    pub daily: Vec<DailyPoint>,
    /// Top referenced pages (inbound edges), capped at 10.
    pub hot_pages: Vec<HotPage>,
    /// Top tags by occurrence, capped at 10.
    pub hot_tags: Vec<HotTag>,
    /// Upcoming SCHEDULED/DEADLINE count in the next 7 days.
    pub upcoming_deadlines: usize,
    pub upcoming_scheduled: usize,
}

#[tauri::command]
pub async fn dashboard_stats(state: State<'_, AppState>) -> AppResult<DashboardStats> {
    let graph = state.current()?;
    let backend = graph.backend.clone();
    let pages = backend.list_pages().await?;
    let blocks = backend.all_blocks().await?;

    // --- overall -------------------------------------------------------
    let mut funnel = TaskFunnel {
        todo: 0,
        doing: 0,
        done: 0,
        later: 0,
        now: 0,
        waiting: 0,
        cancelled: 0,
    };
    let mut tags_total = 0usize;
    let mut refs_total = 0usize;
    for b in &blocks {
        tags_total += b.tags.len();
        refs_total += b.refs_pages.len() + b.refs_blocks.len();
        if let Some(m) = b.task_marker {
            match m {
                TaskMarker::Todo => funnel.todo += 1,
                TaskMarker::Doing => funnel.doing += 1,
                TaskMarker::Done => funnel.done += 1,
                TaskMarker::Later => funnel.later += 1,
                TaskMarker::Now => funnel.now += 1,
                TaskMarker::Waiting => funnel.waiting += 1,
                TaskMarker::Cancelled => funnel.cancelled += 1,
            }
        }
    }
    let tasks_open = funnel.todo + funnel.doing + funnel.later + funnel.now + funnel.waiting;
    let tasks_done = funnel.done;

    let journal_pages = pages.iter().filter(|p| p.journal_day.is_some()).count();
    let overall = OverallStats {
        pages: pages.len(),
        journal_pages,
        blocks: blocks.len(),
        tasks_open,
        tasks_done,
        tags_total,
        refs_total,
    };

    // --- daily activity: last 30 days ---------------------------------
    let today = Local::now().date_naive();
    let start = today - Duration::days(29);
    let mut daily_map: BTreeMap<NaiveDate, (usize, usize)> = BTreeMap::new();
    for i in 0..30 {
        daily_map.insert(start + Duration::days(i), (0, 0));
    }
    for b in &blocks {
        let d = b.created_at.with_timezone(&Local).date_naive();
        if let Some(slot) = daily_map.get_mut(&d) {
            slot.0 += 1;
        }
        if b.task_marker == Some(TaskMarker::Done) {
            let d2 = b.updated_at.with_timezone(&Local).date_naive();
            if let Some(slot) = daily_map.get_mut(&d2) {
                slot.1 += 1;
            }
        }
    }
    let daily: Vec<DailyPoint> = daily_map
        .into_iter()
        .map(|(d, (bc, tc))| DailyPoint {
            date: format!("{:04}-{:02}-{:02}", d.year(), d.month(), d.day()),
            blocks_created: bc,
            tasks_completed: tc,
        })
        .collect();

    // --- hot pages -----------------------------------------------------
    let mut inbound: HashMap<String, usize> = HashMap::new();
    for b in &blocks {
        for name in &b.refs_pages {
            let key = name.trim().to_lowercase();
            if key.is_empty() || key == b.page_id {
                continue;
            }
            *inbound.entry(key).or_insert(0) += 1;
        }
    }
    let page_name_map: HashMap<String, (String, bool)> = pages
        .iter()
        .map(|p| (p.id.clone(), (p.name.clone(), p.journal_day.is_some())))
        .collect();
    let mut hot_pages: Vec<HotPage> = inbound
        .into_iter()
        .map(|(id, count)| {
            let (name, is_journal) = page_name_map
                .get(&id)
                .cloned()
                .unwrap_or_else(|| (id.clone(), false));
            HotPage {
                id,
                name,
                inbound: count,
                is_journal,
            }
        })
        .collect();
    hot_pages.sort_by(|a, b| b.inbound.cmp(&a.inbound).then(a.name.cmp(&b.name)));
    hot_pages.truncate(10);

    // --- hot tags ------------------------------------------------------
    let mut tag_counts: HashMap<String, usize> = HashMap::new();
    for b in &blocks {
        for t in &b.tags {
            *tag_counts.entry(t.clone()).or_insert(0) += 1;
        }
    }
    let mut hot_tags: Vec<HotTag> = tag_counts
        .into_iter()
        .map(|(tag, count)| HotTag { tag, count })
        .collect();
    hot_tags.sort_by(|a, b| b.count.cmp(&a.count).then(a.tag.cmp(&b.tag)));
    hot_tags.truncate(10);

    // --- upcoming (next 7 days, inclusive of today) -------------------
    let cutoff = today + Duration::days(7);
    let iso_today = today.format("%Y-%m-%d").to_string();
    let iso_cutoff = cutoff.format("%Y-%m-%d").to_string();
    let mut upcoming_scheduled = 0usize;
    let mut upcoming_deadlines = 0usize;
    let in_window = |d: &str| d >= iso_today.as_str() && d < iso_cutoff.as_str();
    for b in &blocks {
        if b.task_marker == Some(TaskMarker::Done)
            || b.task_marker == Some(TaskMarker::Cancelled)
        {
            continue;
        }
        if let Some(s) = &b.scheduled {
            if in_window(s) {
                upcoming_scheduled += 1;
            }
        }
        if let Some(d) = &b.deadline {
            if in_window(d) {
                upcoming_deadlines += 1;
            }
        }
    }

    Ok(DashboardStats {
        overall,
        task_funnel: funnel,
        daily,
        hot_pages,
        hot_tags,
        upcoming_deadlines,
        upcoming_scheduled,
    })
}
