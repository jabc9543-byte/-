use tauri::State;

use crate::error::AppResult;
use crate::model::{Page, PageId};
use crate::state::AppState;

#[tauri::command]
pub async fn list_pages(state: State<'_, AppState>) -> AppResult<Vec<Page>> {
    state.current()?.backend.list_pages().await
}

#[tauri::command]
pub async fn get_page(id: PageId, state: State<'_, AppState>) -> AppResult<Option<Page>> {
    state.current()?.backend.get_page(&id).await
}

#[tauri::command]
pub async fn create_page(name: String, state: State<'_, AppState>) -> AppResult<Page> {
    state.current()?.backend.create_page(&name).await
}

#[tauri::command]
pub async fn delete_page(id: PageId, state: State<'_, AppState>) -> AppResult<()> {
    state.current()?.backend.delete_page(&id).await
}

#[tauri::command]
pub async fn rename_page(
    id: PageId,
    new_name: String,
    state: State<'_, AppState>,
) -> AppResult<Page> {
    state.current()?.backend.rename_page(&id, &new_name).await
}

/// Replace the `aliases` list on a page. Alias names are stored inside
/// `page.properties["aliases"]` as a JSON string array and are honoured by
/// `resolve_page` + `backlinks` for case-insensitive matching.
#[tauri::command]
pub async fn set_page_aliases(
    id: PageId,
    aliases: Vec<String>,
    state: State<'_, AppState>,
) -> AppResult<Page> {
    // Normalise: trim + drop empties + dedupe (case-insensitive).
    let mut seen = std::collections::HashSet::new();
    let cleaned: Vec<String> = aliases
        .into_iter()
        .map(|a| a.trim().to_string())
        .filter(|a| !a.is_empty())
        .filter(|a| seen.insert(a.to_lowercase()))
        .collect();
    state
        .current()?
        .backend
        .set_page_aliases(&id, &cleaned)
        .await
}

/// Resolve a user-typed page reference (from `[[...]]` or the search bar)
/// into a concrete `Page`, consulting both page names and their declared
/// aliases case-insensitively. Returns `None` when nothing matches.
#[tauri::command]
pub async fn resolve_page(
    name: String,
    state: State<'_, AppState>,
) -> AppResult<Option<Page>> {
    let needle = name.trim();
    if needle.is_empty() {
        return Ok(None);
    }
    let lower = needle.to_lowercase();
    let backend = state.current()?.backend.clone();
    // Direct id hit is cheapest (names normalise to lowercased ids).
    if let Some(p) = backend.get_page(&lower).await? {
        return Ok(Some(p));
    }
    for p in backend.list_pages().await? {
        if p.name.eq_ignore_ascii_case(needle) {
            return Ok(Some(p));
        }
        if let Some(serde_json::Value::Array(arr)) = p.properties.get("aliases") {
            if arr.iter().any(|v| {
                v.as_str()
                    .map(|s| s.eq_ignore_ascii_case(needle))
                    .unwrap_or(false)
            }) {
                return Ok(Some(p));
            }
        }
    }
    Ok(None)
}
