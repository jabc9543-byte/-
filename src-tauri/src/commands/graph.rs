use std::collections::HashMap;
use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, AppResult};
use crate::model::GraphMeta;
use crate::state::AppState;

/// 在应用私有数据目录下创建并返回默认 Markdown 工作区路径。
/// 用于移动端（Android/iOS）等无法选择任意文件夹的场景。
#[tauri::command]
pub async fn default_graph_dir(app: AppHandle) -> AppResult<String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::Other(format!("resolve app_local_data_dir failed: {e}")))?;
    let dir = base.join("graph");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn open_graph(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<GraphMeta> {
    let g = state.open(PathBuf::from(path), app)?;
    let meta = g.meta.clone();
    // Build the initial full-text index in the background; search commands
    // transparently fall back to backend substring search until it's ready.
    let g2 = g.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = g2.rebuild_search_index().await {
            tracing::warn!(?e, "initial search index build failed");
        }
    });
    Ok(meta)
}

#[tauri::command]
pub async fn close_graph(state: State<'_, AppState>) -> AppResult<()> {
    state.close();
    Ok(())
}

#[tauri::command]
pub async fn current_graph(state: State<'_, AppState>) -> AppResult<Option<GraphMeta>> {
    Ok(state.current().ok().map(|g| g.meta.clone()))
}

#[tauri::command]
pub async fn list_graphs(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    Ok(state
        .recent()
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

/// Manually trigger a backend reload (drops caches, rescans).
/// Useful to force-refresh after bulk external edits without waiting for the
/// filesystem watcher debounce.
#[tauri::command]
pub async fn reload_graph(state: State<'_, AppState>) -> AppResult<()> {
    let graph = state.current()?;
    graph.backend.reload().await?;
    graph.rebuild_search_index().await
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphNode {
    pub id: String,
    pub name: String,
    pub weight: usize,
    pub is_journal: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub weight: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphStats {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

/// Build a page-level reference graph across the whole workspace.
///
/// Nodes are pages; edges aggregate `[[page-ref]]` occurrences from any block
/// on the source page to the target page. Node weight = total inbound + outbound
/// edge weight, used by the frontend to size nodes.
#[tauri::command]
pub async fn graph_stats(state: State<'_, AppState>) -> AppResult<GraphStats> {
    let graph = state.current()?;
    let backend = &graph.backend;
    let pages = backend.list_pages().await?;
    let blocks = backend.all_blocks().await?;

    let mut node_by_id: HashMap<String, GraphNode> = HashMap::new();
    for p in &pages {
        node_by_id.insert(
            p.id.clone(),
            GraphNode {
                id: p.id.clone(),
                name: p.name.clone(),
                weight: 0,
                is_journal: p.journal_day.is_some(),
            },
        );
    }

    // Aggregate edges by (src_page, dst_page_id).
    let mut edge_map: HashMap<(String, String), usize> = HashMap::new();
    for b in &blocks {
        let src = b.page_id.clone();
        for target_name in &b.refs_pages {
            let target_id = target_name.trim().to_lowercase();
            if target_id == src {
                continue; // drop self-loops
            }
            // Auto-create a node for referenced pages that don't exist yet.
            node_by_id.entry(target_id.clone()).or_insert_with(|| GraphNode {
                id: target_id.clone(),
                name: target_name.clone(),
                weight: 0,
                is_journal: false,
            });
            *edge_map.entry((src.clone(), target_id)).or_insert(0) += 1;
        }
    }

    let edges: Vec<GraphEdge> = edge_map
        .into_iter()
        .map(|((source, target), weight)| GraphEdge {
            source,
            target,
            weight,
        })
        .collect();

    for e in &edges {
        if let Some(n) = node_by_id.get_mut(&e.source) {
            n.weight += e.weight;
        }
        if let Some(n) = node_by_id.get_mut(&e.target) {
            n.weight += e.weight;
        }
    }

    let mut nodes: Vec<GraphNode> = node_by_id.into_values().collect();
    nodes.sort_by(|a, b| a.id.cmp(&b.id));

    Ok(GraphStats { nodes, edges })
}
