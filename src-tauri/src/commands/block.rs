use tauri::State;

use crate::error::AppResult;
use crate::model::{Block, BlockId, PageId};
use crate::state::AppState;

#[tauri::command]
pub async fn get_block(id: BlockId, state: State<'_, AppState>) -> AppResult<Option<Block>> {
    state.current()?.backend.get_block(&id).await
}

#[tauri::command]
pub async fn update_block(
    id: BlockId,
    content: String,
    state: State<'_, AppState>,
) -> AppResult<Block> {
    state.current()?.backend.update_block(&id, &content).await
}

#[tauri::command]
pub async fn insert_block(
    page: PageId,
    parent: Option<BlockId>,
    after: Option<BlockId>,
    content: String,
    state: State<'_, AppState>,
) -> AppResult<Block> {
    state
        .current()?
        .backend
        .insert_block(&page, parent, after, &content)
        .await
}

#[tauri::command]
pub async fn delete_block(id: BlockId, state: State<'_, AppState>) -> AppResult<()> {
    state.current()?.backend.delete_block(&id).await
}

#[tauri::command]
pub async fn move_block(
    id: BlockId,
    new_parent: Option<BlockId>,
    new_order: i64,
    state: State<'_, AppState>,
) -> AppResult<Block> {
    state
        .current()?
        .backend
        .move_block(&id, new_parent, new_order)
        .await
}
