//! Automatic backup / time-machine for a graph (module 28).
//!
//! Creates zip snapshots of the graph root directory in a sibling
//! `.logseq-backups/` folder. The scheduler honours a per-graph config
//! (interval, max retained, enabled) persisted alongside the backups.
//!
//! Restore extracts a selected snapshot into a new sibling directory
//! (`<root>.restored-<timestamp>`) so the caller can open it as a fresh
//! graph without racing against the currently-open backend's file handles.

use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex as AsyncMutex;
use tokio::task::JoinHandle;
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

use crate::error::{AppError, AppResult};
use crate::model::StorageKind;

const DEFAULT_INTERVAL_MINS: u32 = 60;
const DEFAULT_MAX_KEEP: u32 = 20;
const CONFIG_FILE: &str = "backup-config.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupConfig {
    pub enabled: bool,
    pub interval_mins: u32,
    pub max_keep: u32,
}

impl Default for BackupConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            interval_mins: DEFAULT_INTERVAL_MINS,
            max_keep: DEFAULT_MAX_KEEP,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BackupKind {
    Manual,
    Auto,
}

impl BackupKind {
    fn as_str(&self) -> &'static str {
        match self {
            BackupKind::Manual => "manual",
            BackupKind::Auto => "auto",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupEntry {
    pub id: String,
    pub filename: String,
    pub size: u64,
    pub created_at: DateTime<Utc>,
    pub kind: BackupKind,
}

/// Manages snapshots and the scheduled auto-backup task for one open graph.
pub struct BackupManager {
    root: PathBuf,
    backups_dir: PathBuf,
    config: RwLock<BackupConfig>,
    task: Mutex<Option<JoinHandle<()>>>,
    last_run_at: RwLock<Option<DateTime<Utc>>>,
    /// Guards concurrent zip/restore/prune operations.
    io_lock: Arc<AsyncMutex<()>>,
}

impl BackupManager {
    pub fn open(root: PathBuf, kind: StorageKind) -> AppResult<Arc<Self>> {
        let backups_dir = backups_dir(&root, kind);
        std::fs::create_dir_all(&backups_dir).map_err(AppError::Io)?;
        let cfg_path = backups_dir.join(CONFIG_FILE);
        let config = load_config(&cfg_path)?.unwrap_or_default();
        Ok(Arc::new(Self {
            root,
            backups_dir,
            config: RwLock::new(config),
            task: Mutex::new(None),
            last_run_at: RwLock::new(None),
            io_lock: Arc::new(AsyncMutex::new(())),
        }))
    }

    pub fn config(&self) -> BackupConfig {
        self.config.read().clone()
    }

    pub fn last_run_at(&self) -> Option<DateTime<Utc>> {
        *self.last_run_at.read()
    }

    pub async fn set_config(self: &Arc<Self>, cfg: BackupConfig) -> AppResult<()> {
        {
            *self.config.write() = cfg.clone();
        }
        save_config(&self.backups_dir.join(CONFIG_FILE), &cfg).await?;
        self.restart_scheduler();
        Ok(())
    }

    /// Starts (or restarts) the periodic scheduler. Safe to call repeatedly.
    pub fn restart_scheduler(self: &Arc<Self>) {
        self.stop_scheduler();
        let cfg = self.config();
        if !cfg.enabled || cfg.interval_mins == 0 {
            return;
        }
        let this = Arc::clone(self);
        let interval = std::time::Duration::from_secs(cfg.interval_mins as u64 * 60);
        let handle = tokio::spawn(async move {
            loop {
                tokio::time::sleep(interval).await;
                let current = this.config();
                if !current.enabled {
                    break;
                }
                if let Err(e) = this.create(BackupKind::Auto).await {
                    tracing::warn!("auto-backup failed: {e}");
                }
            }
        });
        *self.task.lock() = Some(handle);
    }

    pub fn stop_scheduler(&self) {
        if let Some(h) = self.task.lock().take() {
            h.abort();
        }
    }

    pub fn list(&self) -> AppResult<Vec<BackupEntry>> {
        let mut out = Vec::new();
        let dir = match std::fs::read_dir(&self.backups_dir) {
            Ok(d) => d,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
            Err(e) => return Err(AppError::Io(e)),
        };
        for entry in dir {
            let entry = entry.map_err(AppError::Io)?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("zip") {
                continue;
            }
            let filename = path
                .file_name()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
                .unwrap_or_default();
            let meta = entry.metadata().map_err(AppError::Io)?;
            let (created_at, kind) = parse_filename(&filename);
            out.push(BackupEntry {
                id: filename.trim_end_matches(".zip").to_string(),
                filename,
                size: meta.len(),
                created_at,
                kind,
            });
        }
        out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(out)
    }

    pub async fn create(self: &Arc<Self>, kind: BackupKind) -> AppResult<BackupEntry> {
        let _g = self.io_lock.lock().await;
        let root = self.root.clone();
        let dir = self.backups_dir.clone();
        let ts = Utc::now();
        let iso = ts.format("%Y%m%dT%H%M%SZ").to_string();
        let filename = format!("backup-{iso}-{}.zip", kind.as_str());
        let target = dir.join(&filename);
        let target_clone = target.clone();
        tokio::task::spawn_blocking(move || zip_dir(&root, &target_clone, &dir))
            .await
            .map_err(|e| AppError::Other(format!("join error: {e}")))??;
        let meta = tokio::fs::metadata(&target).await.map_err(AppError::Io)?;
        let entry = BackupEntry {
            id: filename.trim_end_matches(".zip").to_string(),
            filename: filename.clone(),
            size: meta.len(),
            created_at: ts,
            kind,
        };
        *self.last_run_at.write() = Some(ts);
        drop(_g);
        self.prune().await?;
        Ok(entry)
    }

    pub async fn delete(&self, id: &str) -> AppResult<()> {
        let _g = self.io_lock.lock().await;
        let path = self.backups_dir.join(format!("{id}.zip"));
        match tokio::fs::remove_file(&path).await {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                Err(AppError::NotFound(format!("backup {id}")))
            }
            Err(e) => Err(AppError::Io(e)),
        }
    }

    /// Extracts the backup into a new sibling directory next to the graph
    /// root and returns its absolute path. The caller is responsible for
    /// opening that directory as a new graph if desired.
    pub async fn restore(&self, id: &str) -> AppResult<PathBuf> {
        let _g = self.io_lock.lock().await;
        let src = self.backups_dir.join(format!("{id}.zip"));
        if !src.exists() {
            return Err(AppError::NotFound(format!("backup {id}")));
        }
        let parent = self
            .root
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf();
        let name = self
            .root
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("graph");
        let ts = Utc::now().format("%Y%m%dT%H%M%SZ");
        let target = parent.join(format!("{name}.restored-{ts}"));
        let target_clone = target.clone();
        tokio::task::spawn_blocking(move || unzip_to(&src, &target_clone))
            .await
            .map_err(|e| AppError::Other(format!("join error: {e}")))??;
        Ok(target)
    }

    async fn prune(&self) -> AppResult<()> {
        let max = self.config().max_keep as usize;
        if max == 0 {
            return Ok(());
        }
        let list = self.list()?;
        if list.len() <= max {
            return Ok(());
        }
        for old in list.into_iter().skip(max) {
            let p = self.backups_dir.join(&old.filename);
            let _ = tokio::fs::remove_file(&p).await;
        }
        Ok(())
    }
}

fn backups_dir(root: &Path, kind: StorageKind) -> PathBuf {
    match kind {
        StorageKind::Markdown => root.join(".logseq-backups"),
        StorageKind::Sqlite => {
            let stem = root
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "graph".to_string());
            let parent = root.parent().unwrap_or(Path::new("."));
            parent.join(format!("{stem}.backups"))
        }
    }
}

fn parse_filename(name: &str) -> (DateTime<Utc>, BackupKind) {
    // backup-<ISO>-<kind>.zip
    let core = name.trim_start_matches("backup-").trim_end_matches(".zip");
    let parts: Vec<&str> = core.splitn(2, '-').collect();
    let (iso, kind_s) = if parts.len() == 2 {
        (parts[0], parts[1])
    } else {
        (core, "auto")
    };
    let kind = if kind_s.starts_with("manual") {
        BackupKind::Manual
    } else {
        BackupKind::Auto
    };
    let ts = chrono::NaiveDateTime::parse_from_str(iso, "%Y%m%dT%H%M%SZ")
        .map(|dt| dt.and_utc())
        .unwrap_or_else(|_| Utc::now());
    (ts, kind)
}

fn zip_dir(src: &Path, dest: &Path, skip_dir: &Path) -> AppResult<()> {
    let file = File::create(dest).map_err(AppError::Io)?;
    let mut zw = ZipWriter::new(file);
    let options: SimpleFileOptions = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);
    let mut buf = Vec::with_capacity(64 * 1024);
    for entry in WalkDir::new(src).follow_links(false) {
        let entry = entry.map_err(|e| AppError::Other(format!("walkdir: {e}")))?;
        let path = entry.path();
        // Skip the backup directory itself and hidden vcs noise.
        if path.starts_with(skip_dir) {
            continue;
        }
        if path == src {
            continue;
        }
        let rel = match path.strip_prefix(src) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let name = rel.to_string_lossy().replace('\\', "/");
        if entry.file_type().is_dir() {
            zw.add_directory(format!("{name}/"), options)
                .map_err(|e| AppError::Other(format!("zip: {e}")))?;
        } else if entry.file_type().is_file() {
            zw.start_file(name, options)
                .map_err(|e| AppError::Other(format!("zip: {e}")))?;
            let mut f = File::open(path).map_err(AppError::Io)?;
            buf.clear();
            f.read_to_end(&mut buf).map_err(AppError::Io)?;
            zw.write_all(&buf).map_err(AppError::Io)?;
        }
    }
    zw.finish()
        .map_err(|e| AppError::Other(format!("zip: {e}")))?;
    Ok(())
}

fn unzip_to(src: &Path, dest: &Path) -> AppResult<()> {
    std::fs::create_dir_all(dest).map_err(AppError::Io)?;
    let file = File::open(src).map_err(AppError::Io)?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| AppError::Other(format!("zip: {e}")))?;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| AppError::Other(format!("zip: {e}")))?;
        let rel = match entry.enclosed_name() {
            Some(p) => p.to_path_buf(),
            None => continue,
        };
        let out_path = dest.join(rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(AppError::Io)?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(AppError::Io)?;
            }
            let mut out = File::create(&out_path).map_err(AppError::Io)?;
            std::io::copy(&mut entry, &mut out).map_err(AppError::Io)?;
        }
    }
    Ok(())
}

fn load_config(path: &Path) -> AppResult<Option<BackupConfig>> {
    match std::fs::read(path) {
        Ok(bytes) => {
            let cfg: BackupConfig = serde_json::from_slice(&bytes)
                .map_err(|e| AppError::Other(format!("invalid backup-config.json: {e}")))?;
            Ok(Some(cfg))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Io(e)),
    }
}

async fn save_config(path: &Path, cfg: &BackupConfig) -> AppResult<()> {
    let bytes = serde_json::to_vec_pretty(cfg)
        .map_err(|e| AppError::Other(format!("serialize: {e}")))?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(AppError::Io)?;
    }
    tokio::fs::write(path, bytes).await.map_err(AppError::Io)?;
    Ok(())
}
