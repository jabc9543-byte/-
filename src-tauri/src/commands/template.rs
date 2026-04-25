//! Block templates (module 18).
//!
//! A template is any block whose first line matches `template:: <name>`. The
//! block's subtree is copied verbatim when instantiated, with a few
//! convenience variables substituted:
//!
//! * `<% today %>`        → today's date in `YYYY-MM-DD`
//! * `<% yesterday %>`    → yesterday
//! * `<% tomorrow %>`     → tomorrow
//! * `<% time %>`         → current local time `HH:MM`
//! * `<% datetime %>`     → `YYYY-MM-DD HH:MM`
//! * `<% NAME %>`         → user-supplied variable (collected before insert)
//!
//! The `template::` property line itself is stripped from the inserted copy.

use std::collections::HashMap;

use chrono::{Datelike, Duration, Local, Timelike};
use regex::Regex;
use serde::Serialize;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::model::{Block, BlockId, PageId};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct TemplateInfo {
    pub id: BlockId,
    pub name: String,
    pub page_id: PageId,
    pub page_name: String,
    pub variables: Vec<String>,
    pub preview: String,
}

fn template_name(content: &str) -> Option<String> {
    // Match `template:: NAME` anywhere in the first ~5 lines, to tolerate
    // leading task markers / front-matter style usage.
    for line in content.lines().take(5) {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("template::") {
            let name = rest.trim().to_string();
            if !name.is_empty() {
                return Some(name);
            }
        }
    }
    None
}

fn strip_template_line(content: &str) -> String {
    let mut out = Vec::new();
    let mut skipped = false;
    for line in content.lines() {
        if !skipped && line.trim().starts_with("template::") {
            skipped = true;
            continue;
        }
        // Also strip a `template-including-parent::` directive so the
        // inserted copy stays clean.
        if !skipped && line.trim().starts_with("template-including-parent::") {
            skipped = true;
            continue;
        }
        out.push(line);
    }
    out.join("\n").trim_start_matches('\n').to_string()
}

fn collect_variables(content: &str, into: &mut Vec<String>) {
    let re = Regex::new(r"<%\s*([^%\s][^%]*?)\s*%>").unwrap();
    for cap in re.captures_iter(content) {
        let raw = cap.get(1).unwrap().as_str().trim().to_string();
        // Skip built-ins.
        match raw.to_lowercase().as_str() {
            "today" | "yesterday" | "tomorrow" | "time" | "datetime" | "now" => continue,
            _ => {}
        }
        // Accept `var: NAME` as an explicit form.
        let name = raw
            .strip_prefix("var:")
            .map(|s| s.trim().to_string())
            .unwrap_or(raw);
        if !into.contains(&name) {
            into.push(name);
        }
    }
}

fn apply_variables(content: &str, vars: &HashMap<String, String>) -> String {
    let re = Regex::new(r"<%\s*([^%]+?)\s*%>").unwrap();
    let now = Local::now();
    re.replace_all(content, |caps: &regex::Captures| {
        let raw = caps[1].trim();
        let key_lc = raw.to_lowercase();
        match key_lc.as_str() {
            "today" | "now" => format!(
                "{:04}-{:02}-{:02}",
                now.year(),
                now.month(),
                now.day()
            ),
            "yesterday" => {
                let d = now - Duration::days(1);
                format!("{:04}-{:02}-{:02}", d.year(), d.month(), d.day())
            }
            "tomorrow" => {
                let d = now + Duration::days(1);
                format!("{:04}-{:02}-{:02}", d.year(), d.month(), d.day())
            }
            "time" => format!("{:02}:{:02}", now.hour(), now.minute()),
            "datetime" => format!(
                "{:04}-{:02}-{:02} {:02}:{:02}",
                now.year(),
                now.month(),
                now.day(),
                now.hour(),
                now.minute()
            ),
            _ => {
                let name = raw
                    .strip_prefix("var:")
                    .map(|s| s.trim().to_string())
                    .unwrap_or_else(|| raw.to_string());
                vars.get(&name).cloned().unwrap_or_default()
            }
        }
    })
    .into_owned()
}

fn first_non_template_line(content: &str) -> String {
    for line in content.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with("template::") {
            continue;
        }
        return t.to_string();
    }
    String::new()
}

/// Scan every block in the graph for `template:: NAME` and return the set of
/// templates available for insertion.
#[tauri::command]
pub async fn list_templates(state: State<'_, AppState>) -> AppResult<Vec<TemplateInfo>> {
    let graph = state.current()?;
    let blocks = graph.backend.all_blocks().await?;
    let pages = graph.backend.list_pages().await?;
    let page_name: HashMap<PageId, String> =
        pages.into_iter().map(|p| (p.id, p.name)).collect();

    // Index children for variable collection across the whole subtree.
    let mut children: HashMap<BlockId, Vec<Block>> = HashMap::new();
    for b in &blocks {
        if let Some(p) = &b.parent_id {
            children.entry(p.clone()).or_default().push(b.clone());
        }
    }
    for siblings in children.values_mut() {
        siblings.sort_by_key(|b| b.order);
    }

    let mut out = Vec::new();
    for b in &blocks {
        if let Some(name) = template_name(&b.content) {
            let mut vars: Vec<String> = Vec::new();
            collect_variables(&b.content, &mut vars);
            // Recursively walk children to collect variables they use.
            let mut stack: Vec<&Block> = Vec::new();
            if let Some(kids) = children.get(&b.id) {
                for k in kids {
                    stack.push(k);
                }
            }
            while let Some(node) = stack.pop() {
                collect_variables(&node.content, &mut vars);
                if let Some(kids) = children.get(&node.id) {
                    for k in kids {
                        stack.push(k);
                    }
                }
            }
            let preview = first_non_template_line(&b.content);
            out.push(TemplateInfo {
                id: b.id.clone(),
                name,
                page_id: b.page_id.clone(),
                page_name: page_name
                    .get(&b.page_id)
                    .cloned()
                    .unwrap_or_default(),
                variables: vars,
                preview,
            });
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Return the variable names used by a specific template (including its
/// descendants). Convenience wrapper around `list_templates`.
#[tauri::command]
pub async fn template_variables(
    id: BlockId,
    state: State<'_, AppState>,
) -> AppResult<Vec<String>> {
    let all = list_templates(state).await?;
    Ok(all.into_iter().find(|t| t.id == id).map(|t| t.variables).unwrap_or_default())
}

/// Instantiate `template_id` into `target_page`, either appended as a new
/// root block or inserted as a child/sibling relative to `target_block`. The
/// template's subtree is deep-copied with variable substitution; the
/// `template::` marker line is stripped from the root.
#[tauri::command]
pub async fn insert_template(
    template_id: BlockId,
    target_page: PageId,
    target_block: Option<BlockId>,
    as_child: bool,
    vars: HashMap<String, String>,
    state: State<'_, AppState>,
) -> AppResult<Vec<Block>> {
    let graph = state.current()?;
    let all = graph.backend.all_blocks().await?;
    let by_id: HashMap<BlockId, Block> =
        all.iter().cloned().map(|b| (b.id.clone(), b)).collect();
    let root = by_id
        .get(&template_id)
        .ok_or_else(|| AppError::NotFound(template_id.clone()))?;

    // Index children per parent, ordered.
    let mut children: HashMap<BlockId, Vec<Block>> = HashMap::new();
    for b in all.iter().cloned() {
        if let Some(p) = &b.parent_id {
            children.entry(p.clone()).or_default().push(b);
        }
    }
    for siblings in children.values_mut() {
        siblings.sort_by_key(|b| b.order);
    }

    // Resolve insertion anchor.
    let (parent, after) = match &target_block {
        Some(anchor) if as_child => (Some(anchor.clone()), None),
        Some(anchor) => {
            let anchor_block = by_id
                .get(anchor)
                .ok_or_else(|| AppError::NotFound(anchor.clone()))?;
            (anchor_block.parent_id.clone(), Some(anchor.clone()))
        }
        None => (None, None),
    };

    // Insert root.
    let root_content = apply_variables(&strip_template_line(&root.content), &vars);
    let root_inserted = graph
        .backend
        .insert_block(&target_page, parent, after, &root_content)
        .await?;

    let mut created: Vec<Block> = vec![root_inserted.clone()];

    // BFS copy children.
    let mut queue: Vec<(BlockId, BlockId)> = Vec::new();
    if let Some(kids) = children.get(&root.id) {
        for k in kids {
            queue.push((k.id.clone(), root_inserted.id.clone()));
        }
    }
    while let Some((src_id, new_parent)) = queue.pop() {
        let Some(src) = by_id.get(&src_id) else {
            continue;
        };
        let content = apply_variables(&src.content, &vars);
        let inserted = graph
            .backend
            .insert_block(&target_page, Some(new_parent.clone()), None, &content)
            .await?;
        created.push(inserted.clone());
        if let Some(kids) = children.get(&src.id) {
            // Preserve order: push reversed so pop() drains in order.
            for k in kids.iter().rev() {
                queue.push((k.id.clone(), inserted.id.clone()));
            }
        }
    }

    Ok(created)
}
