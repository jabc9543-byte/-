use tauri::State;

use crate::error::AppResult;
use crate::model::Block;
use crate::query::{self, Expr};
use crate::state::AppState;

#[tauri::command]
pub async fn run_query(query: String, state: State<'_, AppState>) -> AppResult<Vec<Block>> {
    let blocks = state.current()?.backend.all_blocks().await?;
    query::run(&query, &blocks)
}

/// Parse a query string into its AST — useful for UI validation / previews.
#[tauri::command]
pub async fn parse_query(query: String) -> AppResult<Expr> {
    query::parse::parse(&query).map_err(crate::error::AppError::Invalid)
}
