//! Graph — a thin coordinator around a [`Backend`] that also holds graph metadata
//! and future cross-cutting concerns (query engine, indexes, watchers, plugins).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use chrono::Utc;

use crate::backup::BackupManager;
use crate::ai::AiManager;
use crate::encryption::{self, KeyRing};
use crate::comments::{self, CommentStore};
use crate::error::AppResult;
use crate::model::{GraphMeta, StorageKind};
use crate::search_index::SearchIndex;
use crate::storage::{self, encrypted::EncryptedBackend, Backend, DynBackend};

pub struct Graph {
    pub meta: GraphMeta,
    pub backend: DynBackend,
    pub search_index: Arc<SearchIndex>,
    pub keyring: Arc<KeyRing>,
    /// Path to the encryption metadata file; set whether or not it exists.
    pub encryption_meta_path: PathBuf,
    /// Whether encryption was enabled (meta file present) at open time.
    pub encryption_enabled: bool,
    /// Block-level threaded comments (module 27).
    pub comments: Arc<CommentStore>,
    /// Auto-backup manager (module 28).
    pub backups: Arc<BackupManager>,
    /// Text AI assistant manager (module 21).
    pub ai: Arc<AiManager>,
}

impl Graph {
    pub fn open(path: PathBuf) -> AppResult<Arc<Self>> {
        let kind = storage::detect_kind(&path);
        let raw: Arc<dyn Backend> = match kind {
            StorageKind::Markdown => storage::fs::FsBackend::open(&path)? as Arc<dyn Backend>,
            StorageKind::Sqlite => storage::sqlite::SqliteBackend::open(&path)? as Arc<dyn Backend>,
        };
        let name = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "graph".to_string());
        let encryption_meta_path = encryption::meta_path(&path, kind);
        let encryption_enabled = encryption::load_meta(&encryption_meta_path)?.is_some();
        let keyring = KeyRing::new();
        keyring.set_active(encryption_enabled);
        let backend: DynBackend =
            EncryptedBackend::new(raw, keyring.clone()) as Arc<dyn Backend>;
        let comments = CommentStore::open(comments::store_path(&path, kind))?;
        let backups = BackupManager::open(path.clone(), kind)?;
        backups.restart_scheduler();
        let ai = AiManager::open(path.clone(), kind)?;
        Ok(Arc::new(Self {
            meta: GraphMeta {
                name,
                root: path.to_string_lossy().to_string(),
                kind,
                opened_at: Utc::now(),
            },
            backend,
            search_index: SearchIndex::new()?,
            keyring,
            encryption_meta_path,
            encryption_enabled,
            comments,
            backups,
            ai,
        }))
    }

    /// Scan the backend and (re)build the full-text index.
    pub async fn rebuild_search_index(&self) -> AppResult<()> {
        let pages = self.backend.list_pages().await?;
        let blocks = self.backend.all_blocks().await?;
        let by_id: HashMap<String, String> =
            pages.into_iter().map(|p| (p.id, p.name)).collect();
        self.search_index
            .rebuild(&blocks, |pid| by_id.get(pid).cloned().unwrap_or_default())?;
        Ok(())
    }
}
