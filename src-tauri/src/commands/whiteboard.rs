use tauri::State;

use crate::error::AppResult;
use crate::model::{Whiteboard, WhiteboardSummary};
use crate::state::AppState;

#[tauri::command]
pub async fn list_whiteboards(state: State<'_, AppState>) -> AppResult<Vec<WhiteboardSummary>> {
    state.current()?.backend.list_whiteboards().await
}

#[tauri::command]
pub async fn get_whiteboard(id: String, state: State<'_, AppState>) -> AppResult<Option<Whiteboard>> {
    state.current()?.backend.get_whiteboard(&id).await
}

#[tauri::command]
pub async fn create_whiteboard(name: String, state: State<'_, AppState>) -> AppResult<Whiteboard> {
    state.current()?.backend.create_whiteboard(&name).await
}

#[tauri::command]
pub async fn save_whiteboard(
    id: String,
    data: serde_json::Value,
    state: State<'_, AppState>,
) -> AppResult<Whiteboard> {
    state.current()?.backend.save_whiteboard(&id, data).await
}

#[tauri::command]
pub async fn delete_whiteboard(id: String, state: State<'_, AppState>) -> AppResult<()> {
    state.current()?.backend.delete_whiteboard(&id).await
}

#[tauri::command]
pub async fn rename_whiteboard(
    id: String,
    new_name: String,
    state: State<'_, AppState>,
) -> AppResult<Whiteboard> {
    state
        .current()?
        .backend
        .rename_whiteboard(&id, &new_name)
        .await
}
