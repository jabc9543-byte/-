use chrono::{Datelike, Local};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::model::{Block, Page, TaskMarker};
use crate::parser;
use crate::state::AppState;

fn today_name() -> String {
    let today = Local::now().date_naive();
    format!(
        "{:04}_{:02}_{:02}",
        today.year(),
        today.month(),
        today.day()
    )
}

/// Return today's journal page, creating it if it does not exist.
#[tauri::command]
pub async fn today_journal(state: State<'_, AppState>) -> AppResult<Page> {
    let name = today_name();
    let graph = state.current()?;
    let id = name.trim().to_lowercase();
    if let Some(p) = graph.backend.get_page(&id).await? {
        return Ok(p);
    }
    graph.backend.create_page(&name).await
}

/// Return every journal page in reverse chronological order.
#[tauri::command]
pub async fn list_journals(state: State<'_, AppState>) -> AppResult<Vec<Page>> {
    let graph = state.current()?;
    let mut pages = graph.backend.list_pages().await?;
    pages.retain(|p| p.journal_day.is_some());
    pages.sort_by_key(|p| std::cmp::Reverse(p.journal_day.unwrap_or(0)));
    Ok(pages)
}

/// Rotate the leading `TODO / DOING / DONE / …` marker on a block to the
/// next state in the canonical cycle. Adds `TODO` if the block has no marker.
#[tauri::command]
pub async fn cycle_task(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<Block> {
    let graph = state.current()?;
    let block = graph
        .backend
        .get_block(&id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("block {id}")))?;
    let next = match block.task_marker {
        Some(m) => Some(m.cycle()),
        None => Some(TaskMarker::Todo),
    };
    let new_content = parser::set_task_marker(&block.content, next);
    graph.backend.update_block(&id, &new_content).await
}

/// Explicitly set (or clear with `None`) the task marker on a block.
#[tauri::command]
pub async fn set_task(
    id: String,
    marker: Option<TaskMarker>,
    state: State<'_, AppState>,
) -> AppResult<Block> {
    let graph = state.current()?;
    let block = graph
        .backend
        .get_block(&id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("block {id}")))?;
    let new_content = parser::set_task_marker(&block.content, marker);
    graph.backend.update_block(&id, &new_content).await
}

/// Return all open (TODO / DOING / LATER / NOW / WAITING) blocks across the graph.
#[tauri::command]
pub async fn open_tasks(state: State<'_, AppState>) -> AppResult<Vec<Block>> {
    let graph = state.current()?;
    let all = graph.backend.all_blocks().await?;
    Ok(all
        .into_iter()
        .filter(|b| b.task_marker.map(|m| !m.is_closed()).unwrap_or(false))
        .collect())
}

fn ymd_to_name(day: i32) -> Option<String> {
    if day < 10000000 {
        return None;
    }
    let y = day / 10000;
    let m = (day / 100) % 100;
    let d = day % 100;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some(format!("{y:04}_{m:02}_{d:02}"))
}

fn ymd_to_iso(day: i32) -> Option<String> {
    if day < 10000000 {
        return None;
    }
    let y = day / 10000;
    let m = (day / 100) % 100;
    let d = day % 100;
    Some(format!("{y:04}-{m:02}-{d:02}"))
}

/// Fetch-or-create a journal page for `ymd` (`yyyymmdd` integer). The page is
/// returned regardless of whether it had to be created. Used by the calendar
/// view when the user clicks a day cell.
#[tauri::command]
pub async fn journal_for_date(
    ymd: i32,
    state: State<'_, AppState>,
) -> AppResult<Page> {
    let name = ymd_to_name(ymd)
        .ok_or_else(|| AppError::Invalid(format!("invalid journal date {ymd}")))?;
    let graph = state.current()?;
    let id = name.to_lowercase();
    if let Some(p) = graph.backend.get_page(&id).await? {
        return Ok(p);
    }
    graph.backend.create_page(&name).await
}

/// A day-by-day summary used by the calendar. `scheduled`/`deadline` counts
/// reflect blocks whose `SCHEDULED:<...>`/`DEADLINE:<...>` properties fall
/// on that day; `journal` is true when a dedicated journal page exists.
#[derive(Debug, serde::Serialize)]
pub struct CalendarCell {
    pub ymd: i32,
    pub journal: bool,
    pub scheduled: u32,
    pub deadline: u32,
    pub completed: u32,
}

/// Build a calendar summary for the inclusive `[from_ymd, to_ymd]` range.
/// Exposes just enough information to paint a month grid without shipping
/// every block's content to the frontend.
#[tauri::command]
pub async fn calendar_summary(
    from_ymd: i32,
    to_ymd: i32,
    state: State<'_, AppState>,
) -> AppResult<Vec<CalendarCell>> {
    if to_ymd < from_ymd {
        return Err(AppError::Invalid("to_ymd must be >= from_ymd".into()));
    }
    let graph = state.current()?;
    let pages = graph.backend.list_pages().await?;
    let all_blocks = graph.backend.all_blocks().await?;

    use std::collections::HashMap;
    let mut map: HashMap<i32, CalendarCell> = HashMap::new();
    let in_range = |day: i32| day >= from_ymd && day <= to_ymd;

    for p in &pages {
        if let Some(day) = p.journal_day {
            if in_range(day) {
                map.entry(day)
                    .or_insert(CalendarCell {
                        ymd: day,
                        journal: false,
                        scheduled: 0,
                        deadline: 0,
                        completed: 0,
                    })
                    .journal = true;
            }
        }
    }

    let to_ymd_int = |iso: &str| -> Option<i32> {
        let parts: Vec<&str> = iso.split('-').collect();
        if parts.len() != 3 {
            return None;
        }
        let y: i32 = parts[0].parse().ok()?;
        let m: i32 = parts[1].parse().ok()?;
        let d: i32 = parts[2].parse().ok()?;
        Some(y * 10000 + m * 100 + d)
    };

    for b in &all_blocks {
        let closed = b
            .task_marker
            .map(|m| m.is_closed())
            .unwrap_or(false);
        if let Some(iso) = &b.scheduled {
            if let Some(day) = to_ymd_int(iso) {
                if in_range(day) {
                    let cell = map.entry(day).or_insert(CalendarCell {
                        ymd: day,
                        journal: false,
                        scheduled: 0,
                        deadline: 0,
                        completed: 0,
                    });
                    cell.scheduled += 1;
                    if closed {
                        cell.completed += 1;
                    }
                }
            }
        }
        if let Some(iso) = &b.deadline {
            if let Some(day) = to_ymd_int(iso) {
                if in_range(day) {
                    let cell = map.entry(day).or_insert(CalendarCell {
                        ymd: day,
                        journal: false,
                        scheduled: 0,
                        deadline: 0,
                        completed: 0,
                    });
                    cell.deadline += 1;
                }
            }
        }
    }

    let mut out: Vec<CalendarCell> = map.into_values().collect();
    out.sort_by_key(|c| c.ymd);
    Ok(out)
}

/// Return every block with a `scheduled` or `deadline` on `ymd`. Used by
/// the calendar detail pane to show the selected day's agenda.
#[tauri::command]
pub async fn blocks_for_date(
    ymd: i32,
    state: State<'_, AppState>,
) -> AppResult<Vec<Block>> {
    let iso = ymd_to_iso(ymd)
        .ok_or_else(|| AppError::Invalid(format!("invalid date {ymd}")))?;
    let graph = state.current()?;
    let all = graph.backend.all_blocks().await?;
    Ok(all
        .into_iter()
        .filter(|b| {
            b.scheduled.as_deref() == Some(iso.as_str())
                || b.deadline.as_deref() == Some(iso.as_str())
        })
        .collect())
}

/// A single row in the agenda view. `kind` tells the UI which column to
/// render in (scheduled / deadline / no_date) and `iso_date` is the
/// relevant date so the frontend can bucket by Overdue/Today/Upcoming
/// without reparsing the block content.
#[derive(Debug, serde::Serialize)]
pub struct AgendaItem {
    pub block: Block,
    pub page_name: String,
    pub kind: &'static str,
    pub iso_date: Option<String>,
    pub closed: bool,
}

/// Return all open tasks plus any tasks closed within the last
/// `completed_days` (default 7) days. Includes tasks without a date so the
/// UI can show a "no date" bucket; scheduled/deadline appear as separate
/// rows when both are set on the same block.
#[tauri::command]
pub async fn agenda(
    completed_days: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<Vec<AgendaItem>> {
    use std::collections::HashMap;
    let completed_days = completed_days.unwrap_or(7).max(0);
    let graph = state.current()?;
    let pages = graph.backend.list_pages().await?;
    let name_by_id: HashMap<String, String> =
        pages.into_iter().map(|p| (p.id, p.name)).collect();
    let all = graph.backend.all_blocks().await?;

    let today = Local::now().date_naive();
    let min_closed_iso = today
        .checked_sub_signed(chrono::Duration::days(completed_days))
        .map(|d| d.format("%Y-%m-%d").to_string());

    let mut out = Vec::new();
    for b in all {
        let Some(marker) = b.task_marker else {
            continue;
        };
        let closed = marker.is_closed();
        if closed {
            // Include recently closed tasks so the UI can show "completed".
            // We approximate completion date by the block's `updated_at`.
            let updated = b.updated_at.date_naive().format("%Y-%m-%d").to_string();
            if let Some(min) = &min_closed_iso {
                if &updated < min {
                    continue;
                }
            } else if completed_days == 0 {
                continue;
            }
        }
        let page_name = name_by_id.get(&b.page_id).cloned().unwrap_or_default();
        let mut pushed = false;
        if let Some(iso) = b.scheduled.clone() {
            out.push(AgendaItem {
                block: b.clone(),
                page_name: page_name.clone(),
                kind: "scheduled",
                iso_date: Some(iso),
                closed,
            });
            pushed = true;
        }
        if let Some(iso) = b.deadline.clone() {
            out.push(AgendaItem {
                block: b.clone(),
                page_name: page_name.clone(),
                kind: "deadline",
                iso_date: Some(iso),
                closed,
            });
            pushed = true;
        }
        if !pushed {
            out.push(AgendaItem {
                block: b,
                page_name,
                kind: "none",
                iso_date: None,
                closed,
            });
        }
    }

    // Sort: dated items by (date asc), then no-date at bottom.
    out.sort_by(|a, b| match (&a.iso_date, &b.iso_date) {
        (Some(x), Some(y)) => x.cmp(y),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });
    Ok(out)
}
