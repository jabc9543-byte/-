//! Updater stubs.
//!
//! The runtime updater plugin is intentionally disabled in v0.1.0 (no
//! signing key is configured). The frontend still calls `check_for_update`
//! and `app_version`; we keep the command shapes but make them no-ops so
//! the app boots cleanly without `plugins.updater` config.

use serde::Serialize;
use tauri::AppHandle;

use crate::error::AppResult;

#[derive(Debug, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AppVersionInfo {
    pub version: String,
    pub tauri_version: &'static str,
    pub identifier: String,
}

#[tauri::command]
pub async fn app_version(app: AppHandle) -> AppResult<AppVersionInfo> {
    let cfg = app.config();
    Ok(AppVersionInfo {
        version: cfg
            .version
            .clone()
            .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string()),
        tauri_version: tauri::VERSION,
        identifier: cfg.identifier.clone(),
    })
}

#[tauri::command]
pub async fn check_for_update(_app: AppHandle) -> AppResult<Option<UpdateInfo>> {
    Ok(None)
}

#[tauri::command]
pub async fn install_update(_app: AppHandle) -> AppResult<()> {
    Ok(())
}
