//! Tauri commands for block comments / annotations.

use chrono::Utc;
use tauri::State;

use crate::comments::{new_id, Comment};
use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub async fn list_block_comments(
    block_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<Comment>> {
    Ok(state.current()?.comments.list_for_block(&block_id))
}

#[tauri::command]
pub async fn list_open_comments(state: State<'_, AppState>) -> AppResult<Vec<Comment>> {
    Ok(state.current()?.comments.list_open())
}

#[tauri::command]
pub async fn comment_counts(
    block_id: String,
    state: State<'_, AppState>,
) -> AppResult<(usize, usize)> {
    Ok(state.current()?.comments.count_for_block(&block_id))
}

#[tauri::command]
pub async fn add_comment(
    block_id: String,
    author: String,
    author_color: String,
    body: String,
    parent_id: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<Comment> {
    let now = Utc::now();
    let comment = Comment {
        id: new_id(),
        block_id,
        author,
        author_color,
        body,
        created_at: now,
        updated_at: now,
        resolved: false,
        parent_id,
    };
    state.current()?.comments.add(comment).await
}

#[tauri::command]
pub async fn update_comment(
    id: String,
    body: String,
    state: State<'_, AppState>,
) -> AppResult<Comment> {
    state.current()?.comments.update_body(&id, &body).await
}

#[tauri::command]
pub async fn resolve_comment(
    id: String,
    resolved: bool,
    state: State<'_, AppState>,
) -> AppResult<Comment> {
    state.current()?.comments.set_resolved(&id, resolved).await
}

#[tauri::command]
pub async fn delete_comment(id: String, state: State<'_, AppState>) -> AppResult<()> {
    state.current()?.comments.delete(&id).await
}
