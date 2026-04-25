//! Plugin registry.
//!
//! Plugins live under `<graph>/plugins/<id>/` and consist of:
//!   - `plugin.json` — manifest (id, name, version, description, entry, permissions)
//!   - `main.js`     — the plugin entry point, executed in a sandboxed Web Worker.
//!
//! The host never imports the plugin code directly; the frontend reads
//! `main.js` via [`read_plugin_main`] and starts an isolated worker.

use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default = "default_entry")]
    pub entry: String,
    /// Capability flags. Currently recognised: "readBlocks", "writeBlocks",
    /// "commands", "sidebar", "slashCommands".
    #[serde(default)]
    pub permissions: Vec<String>,
}

fn default_entry() -> String {
    "main.js".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginEntry {
    pub manifest: PluginManifest,
    pub enabled: bool,
    pub installed_at: String,
}

fn plugin_root(state: &AppState) -> AppResult<PathBuf> {
    let root = PathBuf::from(&state.current()?.meta.root).join("plugins");
    fs::create_dir_all(&root)?;
    Ok(root)
}

fn registry_path(state: &AppState) -> AppResult<PathBuf> {
    Ok(plugin_root(state)?.join("registry.json"))
}

fn read_registry(state: &AppState) -> AppResult<Vec<PluginEntry>> {
    let p = registry_path(state)?;
    if !p.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&p)?;
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

fn write_registry(state: &AppState, entries: &[PluginEntry]) -> AppResult<()> {
    let raw = serde_json::to_string_pretty(entries)?;
    fs::write(registry_path(state)?, raw)?;
    Ok(())
}

fn validate_id(id: &str) -> AppResult<()> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
    {
        return Err(AppError::Invalid(format!("invalid plugin id {id}")));
    }
    Ok(())
}

// ---------------- commands ---------------

#[tauri::command]
pub async fn list_plugins(state: State<'_, AppState>) -> AppResult<Vec<PluginEntry>> {
    read_registry(&state)
}

#[tauri::command]
pub async fn install_plugin(
    src_dir: String,
    state: State<'_, AppState>,
) -> AppResult<PluginEntry> {
    install_plugin_impl(&state, &src_dir)
}

/// Shared install path used by both `install_plugin` (local folder) and the
/// marketplace (downloaded + extracted archive). The folder at `src_dir`
/// must contain a valid `plugin.json` at its root.
pub fn install_plugin_impl(state: &AppState, src_dir: &str) -> AppResult<PluginEntry> {
    let src = PathBuf::from(src_dir);
    if !src.is_dir() {
        return Err(AppError::NotFound(src_dir.to_string()));
    }
    let manifest_path = src.join("plugin.json");
    if !manifest_path.is_file() {
        return Err(AppError::Invalid(format!(
            "missing plugin.json in {}",
            src.display()
        )));
    }
    let manifest_raw = fs::read_to_string(&manifest_path)?;
    let manifest: PluginManifest = serde_json::from_str(&manifest_raw)?;
    validate_id(&manifest.id)?;

    let dest = plugin_root(state)?.join(&manifest.id);
    if dest.exists() {
        fs::remove_dir_all(&dest)?;
    }
    copy_dir(&src, &dest)?;

    let mut reg = read_registry(state)?;
    reg.retain(|e| e.manifest.id != manifest.id);
    let entry = PluginEntry {
        manifest,
        enabled: true,
        installed_at: Utc::now().to_rfc3339(),
    };
    reg.push(entry.clone());
    write_registry(state, &reg)?;
    Ok(entry)
}

#[tauri::command]
pub async fn uninstall_plugin(id: String, state: State<'_, AppState>) -> AppResult<()> {
    validate_id(&id)?;
    let mut reg = read_registry(&state)?;
    let before = reg.len();
    reg.retain(|e| e.manifest.id != id);
    if reg.len() == before {
        return Err(AppError::NotFound(id));
    }
    write_registry(&state, &reg)?;
    let dir = plugin_root(&state)?.join(&id);
    if dir.exists() {
        fs::remove_dir_all(dir)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn set_plugin_enabled(
    id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> AppResult<PluginEntry> {
    validate_id(&id)?;
    let mut reg = read_registry(&state)?;
    let Some(entry) = reg.iter_mut().find(|e| e.manifest.id == id) else {
        return Err(AppError::NotFound(id));
    };
    entry.enabled = enabled;
    let out = entry.clone();
    write_registry(&state, &reg)?;
    Ok(out)
}

#[tauri::command]
pub async fn read_plugin_main(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    validate_id(&id)?;
    let reg = read_registry(&state)?;
    let Some(entry) = reg.iter().find(|e| e.manifest.id == id) else {
        return Err(AppError::NotFound(id));
    };
    let dir = plugin_root(&state)?.join(&id);
    let entry_file = entry.manifest.entry.trim_start_matches(['/', '\\']);
    // Prevent path traversal: the resolved entry must stay inside `dir`.
    let full = dir.join(entry_file);
    let canonical_dir = fs::canonicalize(&dir)?;
    let canonical_full = fs::canonicalize(&full)?;
    if !canonical_full.starts_with(&canonical_dir) {
        return Err(AppError::Invalid("entry escapes plugin dir".into()));
    }
    Ok(fs::read_to_string(canonical_full)?)
}

fn copy_dir(src: &PathBuf, dst: &PathBuf) -> AppResult<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}
