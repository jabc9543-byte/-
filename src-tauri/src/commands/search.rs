use tauri::State;

use crate::error::AppResult;
use crate::model::{Block, SearchHit};
use crate::state::AppState;

#[tauri::command]
pub async fn search(
    query: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> AppResult<Vec<SearchHit>> {
    let graph = state.current()?;
    let limit = limit.unwrap_or(50);
    // Prefer the tantivy full-text index; fall back to the backend's naive
    // substring search if the index is empty (e.g. first search before
    // `rebuild_search_index` has finished).
    let hits = graph.search_index.search(&query, limit)?;
    if !hits.is_empty() {
        return Ok(hits);
    }
    graph.backend.search(&query, limit).await
}

/// TF-IDF cosine ranking over block content — surfaces loosely related
/// blocks that keyword BM25 would rank low (module 26).
#[tauri::command]
pub async fn semantic_search(
    query: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> AppResult<Vec<SearchHit>> {
    let graph = state.current()?;
    graph
        .search_index
        .semantic_search(&query, limit.unwrap_or(30))
}

/// "Blocks similar to this one" — uses the same TF-IDF vectors as
/// [`semantic_search`] but seeded from an existing block's content.
#[tauri::command]
pub async fn similar_blocks(
    block_id: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> AppResult<Vec<SearchHit>> {
    let graph = state.current()?;
    graph.search_index.similar(&block_id, limit.unwrap_or(10))
}

/// Force a full rebuild of the search indexes. Normally invoked
/// automatically after transfers/imports; exposed here so the UI can offer
/// a "reindex" button when search feels stale.
#[tauri::command]
pub async fn rebuild_search_index(state: State<'_, AppState>) -> AppResult<()> {
    let graph = state.current()?;
    graph.rebuild_search_index().await
}

#[tauri::command]
pub async fn backlinks(page: String, state: State<'_, AppState>) -> AppResult<Vec<Block>> {
    let backend = state.current()?.backend.clone();
    // Build the list of candidate names: the page's own name plus any
    // declared aliases. That way links written as `[[alias]]` still show up
    // in the canonical page's backlinks panel.
    let mut candidates: Vec<String> = vec![page.clone()];
    for p in backend.list_pages().await? {
        if p.name.eq_ignore_ascii_case(&page) {
            if let Some(serde_json::Value::Array(arr)) = p.properties.get("aliases") {
                for v in arr {
                    if let Some(s) = v.as_str() {
                        candidates.push(s.to_string());
                    }
                }
            }
            // Also: if the requested `page` is itself an alias of some page,
            // return backlinks of the canonical page.
            break;
        }
        if let Some(serde_json::Value::Array(arr)) = p.properties.get("aliases") {
            if arr.iter().any(|v| {
                v.as_str()
                    .map(|s| s.eq_ignore_ascii_case(&page))
                    .unwrap_or(false)
            }) {
                candidates.push(p.name.clone());
                if let Some(serde_json::Value::Array(arr2)) = p.properties.get("aliases") {
                    for v in arr2 {
                        if let Some(s) = v.as_str() {
                            candidates.push(s.to_string());
                        }
                    }
                }
                break;
            }
        }
    }
    let mut seen_blocks = std::collections::HashSet::new();
    let mut out = Vec::new();
    for name in &candidates {
        for b in backend.backlinks(name).await? {
            if seen_blocks.insert(b.id.clone()) {
                out.push(b);
            }
        }
    }
    Ok(out)
}
