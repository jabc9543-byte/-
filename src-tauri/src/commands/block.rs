use tauri::State;

use crate::error::AppResult;
use crate::model::{Block, BlockId, PageId};
use crate::state::AppState;
use crate::storage::Backend;

/// Auto-create stub pages for any `[[wiki-link]]` targets that don't
/// exist yet. This is what makes typing `[[New Page]]` in a block on
/// any platform (desktop or mobile) immediately turn into a working
/// backlink — previously the desktop UI worked around it by
/// auto-creating on click in the inline-ref preview, but mobile has
/// no preview overlay and so the link stayed dangling.
async fn ensure_referenced_pages(backend: &dyn Backend, refs: &[String]) {
    for name in refs {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            continue;
        }
        let id = trimmed.to_lowercase();
        match backend.get_page(&id).await {
            Ok(Some(_)) => {}
            _ => {
                // Ignore "already exists" / racy creation errors.
                let _ = backend.create_page(trimmed).await;
            }
        }
    }
}

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
    let g = state.current()?;
    let block = g.backend.update_block(&id, &content).await?;
    ensure_referenced_pages(&*g.backend, &block.refs_pages).await;
    Ok(block)
}

#[tauri::command]
pub async fn insert_block(
    page: PageId,
    parent: Option<BlockId>,
    after: Option<BlockId>,
    content: String,
    state: State<'_, AppState>,
) -> AppResult<Block> {
    let g = state.current()?;
    let block = g
        .backend
        .insert_block(&page, parent, after, &content)
        .await?;
    ensure_referenced_pages(&*g.backend, &block.refs_pages).await;
    Ok(block)
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
