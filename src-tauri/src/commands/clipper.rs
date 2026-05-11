//! Web Clipper receiver.
//!
//! Receives a clipped article (title, source URL, markdown body, optional
//! tags) from an external source — typically the Obsidian Web Clipper
//! browser extension — and writes it into the active graph as either:
//!
//! 1. A new page (`mode = "page"`, the default for non-empty titles), or
//! 2. A new block under today's journal (`mode = "journal"`).
//!
//! The frontend reaches this command in two ways:
//!  - Tauri `deep-link` plugin: URL scheme `quanshiwei://clip?title=...&url=...&body=...`
//!    parsed in the renderer and forwarded here via `invoke("receive_clip", ...)`.
//!  - A future local HTTP receiver (desktop only) that POSTs the same payload.
//!
//! No code from the clipped page is ever executed — the payload is plain
//! markdown that goes straight into the graph backend.

use chrono::{Datelike, Local};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::AppResult;
use crate::model::Block;
use crate::state::AppState;

#[derive(Debug, Clone, Deserialize)]
pub struct ClipPayload {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub tags: Vec<String>,
    /// "page" or "journal". Defaults to "journal" when title is empty,
    /// otherwise "page".
    #[serde(default)]
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClipResult {
    pub page_id: String,
    pub page_name: String,
    pub block_id: String,
    pub mode: String,
}

fn today_name() -> String {
    let today = Local::now().date_naive();
    format!(
        "{:04}_{:02}_{:02}",
        today.year(),
        today.month(),
        today.day()
    )
}

fn sanitize_title(raw: &str) -> String {
    let mut out: String = raw
        .chars()
        .map(|c| match c {
            // Avoid characters that would break wiki-link parsing or
            // create awful filenames on any platform.
            '/' | '\\' | '|' | ':' | '*' | '?' | '"' | '<' | '>' | '[' | ']' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    out = out.split_whitespace().collect::<Vec<_>>().join(" ");
    if out.is_empty() {
        out = "Clipped".to_string();
    }
    if out.len() > 120 {
        out.truncate(120);
    }
    out
}

fn render_clip(payload: &ClipPayload) -> String {
    let mut s = String::new();
    if !payload.url.is_empty() {
        s.push_str(&format!("source:: {}\n", payload.url));
    }
    if !payload.tags.is_empty() {
        let tag_line: Vec<String> = payload
            .tags
            .iter()
            .filter_map(|t| {
                let t = t.trim();
                if t.is_empty() {
                    None
                } else if t.starts_with('#') {
                    Some(t.to_string())
                } else {
                    Some(format!("#{t}"))
                }
            })
            .collect();
        if !tag_line.is_empty() {
            s.push_str(&tag_line.join(" "));
            s.push('\n');
        }
    }
    if !payload.body.is_empty() {
        if !s.is_empty() {
            s.push('\n');
        }
        s.push_str(&payload.body);
    }
    if s.is_empty() {
        s.push_str(&payload.title);
    }
    s
}

/// Persist a clipped article into the active graph.
#[tauri::command]
pub async fn receive_clip(
    payload: ClipPayload,
    state: State<'_, AppState>,
) -> AppResult<ClipResult> {
    let g = state.current()?;
    let backend = &g.backend;

    let title = sanitize_title(&payload.title);
    let body_md = render_clip(&payload);

    let chosen_mode = payload
        .mode
        .as_deref()
        .map(|m| m.to_lowercase())
        .unwrap_or_else(|| {
            if title == "Clipped" {
                "journal".to_string()
            } else {
                "page".to_string()
            }
        });

    match chosen_mode.as_str() {
        "page" => {
            let page = backend.create_page(&title).await?;
            let block: Block = backend
                .insert_block(&page.id, None, None, &body_md)
                .await?;
            Ok(ClipResult {
                page_id: page.id,
                page_name: page.name,
                block_id: block.id,
                mode: "page".into(),
            })
        }
        _ => {
            // journal
            let name = today_name();
            let id = name.trim().to_lowercase();
            let page = match backend.get_page(&id).await? {
                Some(p) => p,
                None => backend.create_page(&name).await?,
            };
            let header = if title == "Clipped" {
                String::new()
            } else if payload.url.is_empty() {
                format!("**{}**\n", title)
            } else {
                format!("[{}]({})\n", title, payload.url)
            };
            let block: Block = backend
                .insert_block(&page.id, None, None, &format!("{header}{body_md}"))
                .await?;
            Ok(ClipResult {
                page_id: page.id,
                page_name: page.name,
                block_id: block.id,
                mode: "journal".into(),
            })
        }
    }
}
