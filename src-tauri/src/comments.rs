//! Block-level threaded comments / annotations (module 27).
//!
//! Comments are persisted as a single JSON file sidecar to the graph. Each
//! comment is anchored to a block id and may optionally reply to another
//! comment (flat threading: only one level of reply). Content is plaintext —
//! unlike block text it is not covered by the end-to-end encryption module.
//!
//! Storage path:
//! * Markdown backend → `<root>/logseq/comments.json`
//! * SQLite backend   → `<stem>.comments.json` next to the database file.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::error::{AppError, AppResult};
use crate::model::StorageKind;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comment {
    pub id: String,
    pub block_id: String,
    pub author: String,
    pub author_color: String,
    pub body: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub resolved: bool,
    pub parent_id: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct CommentFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    comments: Vec<Comment>,
}

/// In-memory comment store with write-through persistence to JSON on disk.
pub struct CommentStore {
    path: PathBuf,
    inner: RwLock<Vec<Comment>>,
    write_lock: Mutex<()>,
}

impl CommentStore {
    pub fn open(path: PathBuf) -> AppResult<Arc<Self>> {
        let comments = match std::fs::read(&path) {
            Ok(bytes) => {
                let file: CommentFile = serde_json::from_slice(&bytes)
                    .map_err(|e| AppError::Other(format!("invalid comments.json: {e}")))?;
                file.comments
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(AppError::Io(e)),
        };
        Ok(Arc::new(Self {
            path,
            inner: RwLock::new(comments),
            write_lock: Mutex::new(()),
        }))
    }

    pub fn list_for_block(&self, block_id: &str) -> Vec<Comment> {
        let guard = self.inner.read();
        let mut out: Vec<Comment> = guard
            .iter()
            .filter(|c| c.block_id == block_id)
            .cloned()
            .collect();
        out.sort_by_key(|c| c.created_at);
        out
    }

    pub fn list_open(&self) -> Vec<Comment> {
        let guard = self.inner.read();
        let mut out: Vec<Comment> = guard
            .iter()
            .filter(|c| !c.resolved && c.parent_id.is_none())
            .cloned()
            .collect();
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        out
    }

    pub fn count_for_block(&self, block_id: &str) -> (usize, usize) {
        let guard = self.inner.read();
        let mut total = 0usize;
        let mut open = 0usize;
        for c in guard.iter().filter(|c| c.block_id == block_id) {
            total += 1;
            if !c.resolved {
                open += 1;
            }
        }
        (total, open)
    }

    pub fn get(&self, id: &str) -> Option<Comment> {
        self.inner.read().iter().find(|c| c.id == id).cloned()
    }

    pub async fn add(&self, comment: Comment) -> AppResult<Comment> {
        {
            let mut guard = self.inner.write();
            guard.push(comment.clone());
        }
        self.persist().await?;
        Ok(comment)
    }

    pub async fn update_body(&self, id: &str, body: &str) -> AppResult<Comment> {
        let updated = {
            let mut guard = self.inner.write();
            let c = guard
                .iter_mut()
                .find(|c| c.id == id)
                .ok_or_else(|| AppError::NotFound(format!("comment {id}")))?;
            c.body = body.to_string();
            c.updated_at = Utc::now();
            c.clone()
        };
        self.persist().await?;
        Ok(updated)
    }

    pub async fn set_resolved(&self, id: &str, resolved: bool) -> AppResult<Comment> {
        let updated = {
            let mut guard = self.inner.write();
            let c = guard
                .iter_mut()
                .find(|c| c.id == id)
                .ok_or_else(|| AppError::NotFound(format!("comment {id}")))?;
            c.resolved = resolved;
            c.updated_at = Utc::now();
            c.clone()
        };
        self.persist().await?;
        Ok(updated)
    }

    pub async fn delete(&self, id: &str) -> AppResult<()> {
        {
            let mut guard = self.inner.write();
            let before = guard.len();
            guard.retain(|c| c.id != id && c.parent_id.as_deref() != Some(id));
            if guard.len() == before {
                return Err(AppError::NotFound(format!("comment {id}")));
            }
        }
        self.persist().await?;
        Ok(())
    }

    async fn persist(&self) -> AppResult<()> {
        let _w = self.write_lock.lock().await;
        let file = CommentFile {
            version: 1,
            comments: self.inner.read().clone(),
        };
        let bytes = serde_json::to_vec_pretty(&file)
            .map_err(|e| AppError::Other(format!("serialize comments: {e}")))?;
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(AppError::Io)?;
        }
        tokio::fs::write(&self.path, bytes).await.map_err(AppError::Io)?;
        Ok(())
    }
}

pub fn store_path(root: &Path, kind: StorageKind) -> PathBuf {
    match kind {
        StorageKind::Markdown => root.join("logseq").join("comments.json"),
        StorageKind::Sqlite => {
            let stem = root
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "graph".to_string());
            let parent = root.parent().unwrap_or(Path::new("."));
            parent.join(format!("{stem}.comments.json"))
        }
    }
}

/// Generate a new opaque comment id using timestamp + random suffix.
pub fn new_id() -> String {
    use rand::Rng;
    let ts = Utc::now().timestamp_millis();
    let suffix: u64 = rand::thread_rng().gen();
    format!("c-{ts:x}-{suffix:x}")
}
