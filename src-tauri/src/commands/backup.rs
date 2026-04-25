//! Tauri commands for the auto-backup / time machine module.

use tauri::State;

use crate::backup::{BackupConfig, BackupEntry, BackupKind};
use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub async fn list_backups(state: State<'_, AppState>) -> AppResult<Vec<BackupEntry>> {
    state.current()?.backups.list()
}

#[tauri::command]
pub async fn backup_config(state: State<'_, AppState>) -> AppResult<BackupConfig> {
    Ok(state.current()?.backups.config())
}

#[tauri::command]
pub async fn set_backup_config(
    config: BackupConfig,
    state: State<'_, AppState>,
) -> AppResult<BackupConfig> {
    let mgr = state.current()?.backups.clone();
    mgr.set_config(config).await?;
    Ok(mgr.config())
}

#[tauri::command]
pub async fn create_backup(state: State<'_, AppState>) -> AppResult<BackupEntry> {
    let mgr = state.current()?.backups.clone();
    mgr.create(BackupKind::Manual).await
}

#[tauri::command]
pub async fn delete_backup(id: String, state: State<'_, AppState>) -> AppResult<()> {
    state.current()?.backups.delete(&id).await
}

#[tauri::command]
pub async fn restore_backup(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let path = state.current()?.backups.restore(&id).await?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn last_backup_at(state: State<'_, AppState>) -> AppResult<Option<String>> {
    Ok(state
        .current()?
        .backups
        .last_run_at()
        .map(|t| t.to_rfc3339()))
}
