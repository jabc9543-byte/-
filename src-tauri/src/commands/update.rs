//! Auto-updater wrappers (module 14).
//!
//! Thin Tauri commands over `tauri-plugin-updater` that expose
//! "check for update", "install update" and "current version" to the
//! frontend. We intentionally keep the surface small: the frontend polls
//! `check_for_update`, renders an in-app banner when a new version is
//! returned, and calls `install_update` when the user accepts.

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::error::{AppError, AppResult};

#[derive(Debug, Serialize)]
pub struct UpdateInfo {
    /// Remote version string exactly as returned by the updater manifest.
    pub version: String,
    /// Current running application version (`CARGO_PKG_VERSION`).
    pub current_version: String,
    /// Human-readable release notes pulled from the manifest.
    pub notes: Option<String>,
    /// ISO-8601 release date, if present in the manifest.
    pub date: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AppVersionInfo {
    pub version: String,
    pub tauri_version: &'static str,
    pub identifier: String,
}

fn map_err<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Invalid(format!("updater: {e}"))
}

/// Return basic information about the running application. Used by the
/// Settings dialog to display the current version.
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

/// Ping the configured updater endpoint. Returns `Some` when a newer
/// version is available, `None` otherwise. The function never installs
/// anything — it only resolves the manifest.
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> AppResult<Option<UpdateInfo>> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let updater = app.updater().map_err(map_err)?;
    match updater.check().await {
        Ok(Some(u)) => Ok(Some(UpdateInfo {
            version: u.version.clone(),
            current_version: current,
            notes: u.body.clone(),
            date: u.date.map(|d| d.to_string()),
        })),
        Ok(None) => Ok(None),
        Err(e) => Err(map_err(e)),
    }
}

/// Download the pending update and install it. On Windows/macOS this
/// hands off to the native installer; on Linux (AppImage) the binary is
/// swapped in place. The app relaunches automatically.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> AppResult<()> {
    let updater = app.updater().map_err(map_err)?;
    let update = updater
        .check()
        .await
        .map_err(map_err)?
        .ok_or_else(|| AppError::Invalid("no update available".into()))?;

    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(map_err)?;

    app.restart();
}
