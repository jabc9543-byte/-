//! Image and audio asset import for the mobile editor.
//!
//! Images are stored under `<graph_root>/assets/images/<id>.<ext>` and
//! audio recordings under `<graph_root>/assets/audio/<id>.<ext>`. The
//! returned `rel_path` is suitable for direct embedding via Markdown
//! image syntax (`![](assets/images/<id>.png)`) — the existing asset
//! resolver in the renderer already handles the `assets/` prefix.

use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct AssetRef {
    pub id: String,
    pub rel_path: String,
}

fn graph_root(state: &AppState) -> AppResult<PathBuf> {
    Ok(PathBuf::from(&state.current()?.meta.root))
}

fn ensure_dir(state: &AppState, sub: &str) -> AppResult<PathBuf> {
    let dir = graph_root(state)?.join("assets").join(sub);
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn sanitize_ext(name: &str, allowed: &[&str], default_ext: &str) -> String {
    let lower = name.to_ascii_lowercase();
    if let Some(dot) = lower.rfind('.') {
        let ext = &lower[dot + 1..];
        if allowed
            .iter()
            .any(|a| a.eq_ignore_ascii_case(ext))
            && ext.chars().all(|c| c.is_ascii_alphanumeric())
        {
            return ext.to_string();
        }
    }
    default_ext.to_string()
}

fn write_asset(
    state: &AppState,
    sub: &str,
    id: &str,
    ext: &str,
    bytes: &[u8],
) -> AppResult<String> {
    let dir = ensure_dir(state, sub)?;
    let filename = format!("{id}.{ext}");
    let dest = dir.join(&filename);
    fs::write(&dest, bytes)?;
    Ok(format!("assets/{sub}/{filename}"))
}

#[tauri::command]
pub async fn import_image_bytes(
    name: String,
    bytes: Vec<u8>,
    state: State<'_, AppState>,
) -> AppResult<AssetRef> {
    if bytes.is_empty() {
        return Err(AppError::Invalid("image bytes cannot be empty".into()));
    }
    let ext = sanitize_ext(
        &name,
        &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic"],
        "png",
    );
    let id = nanoid::nanoid!(12);
    let rel = write_asset(&state, "images", &id, &ext, &bytes)?;
    Ok(AssetRef { id, rel_path: rel })
}

#[tauri::command]
pub async fn import_audio_bytes(
    name: String,
    bytes: Vec<u8>,
    state: State<'_, AppState>,
) -> AppResult<AssetRef> {
    if bytes.is_empty() {
        return Err(AppError::Invalid("audio bytes cannot be empty".into()));
    }
    let ext = sanitize_ext(
        &name,
        &["webm", "ogg", "mp3", "m4a", "wav", "aac", "mp4"],
        "webm",
    );
    let id = nanoid::nanoid!(12);
    let rel = write_asset(&state, "audio", &id, &ext, &bytes)?;
    Ok(AssetRef { id, rel_path: rel })
}

/// Read raw bytes for any asset stored under `<graph_root>/assets/`.
/// Used by the renderer to materialise images/audio as blob URLs on
/// platforms (Android WebView) where the custom asset protocol isn't
/// available.
#[tauri::command]
pub async fn read_asset_bytes(
    rel_path: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<u8>> {
    // Reject path traversal: only allow `assets/<sub>/<file>` with no
    // back-references.
    let clean = rel_path.replace('\\', "/");
    if clean.contains("..") || clean.starts_with('/') {
        return Err(AppError::Invalid("invalid asset path".into()));
    }
    if !clean.starts_with("assets/") {
        return Err(AppError::Invalid("asset path must be under assets/".into()));
    }
    let path = graph_root(&state)?.join(&clean);
    if !path.is_file() {
        return Err(AppError::NotFound(rel_path));
    }
    Ok(fs::read(path)?)
}
