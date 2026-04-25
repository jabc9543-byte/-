//! Tauri commands for the text AI assistant (module 21).

use nanoid::nanoid;
use tauri::{AppHandle, State};

use crate::ai::{AiConfigPatch, AiConfigView, AiMessage};
use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub async fn ai_config(state: State<'_, AppState>) -> AppResult<AiConfigView> {
    Ok(state.current()?.ai.config_view())
}

#[tauri::command]
pub async fn set_ai_config(
    patch: AiConfigPatch,
    state: State<'_, AppState>,
) -> AppResult<AiConfigView> {
    state.current()?.ai.set_config(patch)
}

#[tauri::command]
pub async fn ai_complete(
    messages: Vec<AiMessage>,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let mgr = state.current()?.ai.clone();
    mgr.complete(messages).await
}

/// Starts a streaming completion. Returns the generated `session` id that
/// the UI should listen on (`ai://delta-<id>`, `ai://done-<id>`,
/// `ai://error-<id>`). The UI cancels by ignoring further events.
#[tauri::command]
pub async fn ai_complete_stream(
    messages: Vec<AiMessage>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let mgr = state.current()?.ai.clone();
    let session = nanoid!(10);
    mgr.complete_stream(app, session.clone(), messages)?;
    Ok(session)
}
