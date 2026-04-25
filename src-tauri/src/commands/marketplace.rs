//! Plugin marketplace / remote install (module 23).
//!
//! A "marketplace" is any HTTP endpoint that serves a JSON array of
//! [`MarketplaceEntry`] objects. Users configure one or more registry URLs
//! on the frontend; the backend is stateless and only exposes two commands:
//!
//! * [`fetch_marketplace`] — GET a registry URL, parse and return its entries.
//! * [`install_plugin_from_url`] — download a ZIP, optionally verify its
//!   SHA-256, unpack into a temp directory, then hand off to the regular
//!   plugin install flow to copy it into `<graph>/plugins/<id>`.
//!
//! No plugin code is ever executed during install — the downloaded archive
//! is only extracted and its `plugin.json` validated. Execution still happens
//! in the sandboxed worker at runtime.

use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

use super::plugin::{PluginEntry, PluginManifest};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplaceEntry {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub homepage: String,
    #[serde(default)]
    pub tags: Vec<String>,
    /// URL of a ZIP archive containing `plugin.json` + `main.js`.
    pub download_url: String,
    /// Optional hex-encoded SHA-256 of the archive for integrity checks.
    #[serde(default)]
    pub sha256: Option<String>,
    /// Declared permissions (informational; the real list lives in plugin.json).
    #[serde(default)]
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplaceListing {
    pub source: String,
    pub entries: Vec<MarketplaceEntry>,
    pub fetched_at: String,
}

#[tauri::command]
pub async fn fetch_marketplace(url: String) -> AppResult<MarketplaceListing> {
    if !is_safe_url(&url) {
        return Err(AppError::Invalid(format!("unsafe registry url: {url}")));
    }
    let client = http_client()?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("fetch failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Other(format!(
            "registry returned {}",
            resp.status()
        )));
    }
    // Accept either a raw array or `{ "plugins": [...] }`.
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Other(format!("invalid registry json: {e}")))?;
    let entries: Vec<MarketplaceEntry> = match body {
        serde_json::Value::Array(_) => serde_json::from_value(body)?,
        serde_json::Value::Object(ref obj) => {
            if let Some(plugins) = obj.get("plugins").cloned() {
                serde_json::from_value(plugins)?
            } else {
                return Err(AppError::Invalid("registry json missing `plugins`".into()));
            }
        }
        _ => return Err(AppError::Invalid("registry json has wrong shape".into())),
    };
    Ok(MarketplaceListing {
        source: url,
        entries,
        fetched_at: Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn install_plugin_from_url(
    entry: MarketplaceEntry,
    state: State<'_, AppState>,
) -> AppResult<PluginEntry> {
    if !is_safe_url(&entry.download_url) {
        return Err(AppError::Invalid(format!(
            "unsafe download url: {}",
            entry.download_url
        )));
    }
    let bytes = download_bytes(&entry.download_url).await?;
    if let Some(expected) = &entry.sha256 {
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let got = hex(&hasher.finalize());
        if !got.eq_ignore_ascii_case(expected) {
            return Err(AppError::Invalid(format!(
                "sha256 mismatch: expected {expected}, got {got}"
            )));
        }
    }

    // Extract into a temp directory scoped to the graph, then hand the path
    // to the regular install flow. Using a temp dir keeps corrupt archives
    // from touching `<graph>/plugins/` until we know the manifest is valid.
    let graph_root = PathBuf::from(&state.current()?.meta.root);
    let staging = graph_root
        .join(".plugin-stage")
        .join(format!("install-{}", nanoid::nanoid!()));
    fs::create_dir_all(&staging)?;

    let extract_result = unzip_to(&bytes, &staging);
    if let Err(e) = extract_result {
        let _ = fs::remove_dir_all(&staging);
        return Err(e);
    }

    // If the zip wraps everything in a single top-level directory, descend
    // into it. `install_plugin` expects to find `plugin.json` directly.
    let plugin_src = normalise_staging(&staging)?;

    let manifest_path = plugin_src.join("plugin.json");
    if !manifest_path.is_file() {
        let _ = fs::remove_dir_all(&staging);
        return Err(AppError::Invalid(format!(
            "plugin.json not found after extracting {}",
            entry.download_url
        )));
    }
    let manifest_raw = fs::read_to_string(&manifest_path)?;
    let manifest: PluginManifest = serde_json::from_str(&manifest_raw)?;
    if manifest.id != entry.id {
        let _ = fs::remove_dir_all(&staging);
        return Err(AppError::Invalid(format!(
            "manifest id ({}) does not match listing id ({})",
            manifest.id, entry.id
        )));
    }

    let src_dir = plugin_src.to_string_lossy().to_string();
    let installed = super::plugin::install_plugin_impl(&state, &src_dir)?;
    let _ = fs::remove_dir_all(&staging);
    Ok(installed)
}

// ---- helpers -------------------------------------------------------------

fn http_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!("logseq-rs/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Other(format!("http client: {e}")))
}

async fn download_bytes(url: &str) -> AppResult<Vec<u8>> {
    let client = http_client()?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("download failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Other(format!(
            "download returned {}",
            resp.status()
        )));
    }
    // Cap at 20 MiB — plugin archives should be tiny.
    const MAX: u64 = 20 * 1024 * 1024;
    if let Some(len) = resp.content_length() {
        if len > MAX {
            return Err(AppError::Invalid(format!(
                "archive too large ({len} bytes)"
            )));
        }
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Other(format!("download body: {e}")))?;
    if bytes.len() as u64 > MAX {
        return Err(AppError::Invalid("archive too large".into()));
    }
    Ok(bytes.to_vec())
}

fn unzip_to(bytes: &[u8], dest: &PathBuf) -> AppResult<()> {
    let reader = std::io::Cursor::new(bytes);
    let mut zip = zip::ZipArchive::new(reader)
        .map_err(|e| AppError::Invalid(format!("not a zip archive: {e}")))?;
    for i in 0..zip.len() {
        let mut file = zip
            .by_index(i)
            .map_err(|e| AppError::Other(format!("zip read: {e}")))?;
        let Some(enclosed) = file.enclosed_name() else {
            return Err(AppError::Invalid(format!(
                "archive entry has unsafe path: {}",
                file.name()
            )));
        };
        let out_path = dest.join(enclosed);
        // Defence in depth — ensure the resolved path stays under dest.
        if !out_path.starts_with(dest) {
            return Err(AppError::Invalid("archive path escapes staging dir".into()));
        }
        if file.is_dir() {
            fs::create_dir_all(&out_path)?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut out = fs::File::create(&out_path)?;
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)
            .map_err(|e| AppError::Other(format!("zip decode: {e}")))?;
        out.write_all(&buf)?;
    }
    Ok(())
}

/// If `staging/` contains exactly one directory and no top-level files,
/// return that directory; otherwise return `staging` itself.
fn normalise_staging(staging: &PathBuf) -> AppResult<PathBuf> {
    let mut dirs = Vec::new();
    let mut has_file = false;
    for entry in fs::read_dir(staging)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        if ft.is_dir() {
            dirs.push(entry.path());
        } else if ft.is_file() {
            has_file = true;
        }
    }
    if !has_file && dirs.len() == 1 {
        Ok(dirs.remove(0))
    } else {
        Ok(staging.clone())
    }
}

fn is_safe_url(url: &str) -> bool {
    url.starts_with("https://")
        || url.starts_with("http://localhost")
        || url.starts_with("http://127.0.0.1")
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}
