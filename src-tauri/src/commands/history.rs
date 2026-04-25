//! Block history / version rollback commands.
//!
//! Snapshots of prior block content are written by the storage layer
//! automatically on every mutation. These commands expose the timeline to
//! the UI and allow restoring a past version.

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::model::{Block, BlockHistoryEntry, BlockId};
use crate::state::AppState;

const DEFAULT_LIMIT: usize = 50;

#[tauri::command]
pub async fn block_history(
    id: BlockId,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> AppResult<Vec<BlockHistoryEntry>> {
    let limit = limit.unwrap_or(DEFAULT_LIMIT).min(500).max(1);
    state.current()?.backend.list_block_history(&id, limit).await
}

#[tauri::command]
pub async fn restore_block_version(
    id: BlockId,
    entry_id: String,
    state: State<'_, AppState>,
) -> AppResult<Block> {
    let backend = state.current()?.backend.clone();
    let history = backend.list_block_history(&id, 500).await?;
    let entry = history
        .into_iter()
        .find(|e| e.id == entry_id)
        .ok_or_else(|| AppError::NotFound(format!("history entry {entry_id}")))?;
    // update_block itself captures a fresh snapshot of the current content
    // before writing the restored version, preserving the audit trail.
    backend.update_block(&id, &entry.content).await
}
