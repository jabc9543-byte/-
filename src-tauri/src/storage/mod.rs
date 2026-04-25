//! Storage abstraction.
//!
//! Two interchangeable backends implement the same [`Backend`] trait:
//! * [`fs::FsBackend`]   — Logseq-compatible folder of Markdown files.
//! * [`sqlite::SqliteBackend`] — single `.db` file (Logseq DB-graph analogue).
//!
//! The high-level [`crate::graph::Graph`] drives either uniformly.

pub mod fs;
pub mod sqlite;
pub mod encrypted;

use async_trait::async_trait;

use crate::error::AppResult;
use crate::model::{Block, BlockHistoryEntry, BlockId, Page, PageId, SearchHit, StorageKind, Whiteboard, WhiteboardSummary};

/// Detect the most appropriate backend kind for a given path.
pub fn detect_kind(path: &std::path::Path) -> StorageKind {
    if path.is_file()
        && path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case("db") || s.eq_ignore_ascii_case("sqlite"))
            .unwrap_or(false)
    {
        StorageKind::Sqlite
    } else {
        StorageKind::Markdown
    }
}

#[async_trait]
pub trait Backend: Send + Sync {
    fn kind(&self) -> StorageKind;

    async fn list_pages(&self) -> AppResult<Vec<Page>>;
    async fn get_page(&self, id: &PageId) -> AppResult<Option<Page>>;
    async fn create_page(&self, name: &str) -> AppResult<Page>;
    async fn delete_page(&self, id: &PageId) -> AppResult<()>;
    async fn rename_page(&self, id: &PageId, new_name: &str) -> AppResult<Page>;

    /// Replace the `aliases` property of a page. An empty slice clears the
    /// aliases. Returns the updated page.
    async fn set_page_aliases(&self, id: &PageId, aliases: &[String]) -> AppResult<Page>;

    async fn get_block(&self, id: &BlockId) -> AppResult<Option<Block>>;
    async fn update_block(&self, id: &BlockId, content: &str) -> AppResult<Block>;
    async fn insert_block(
        &self,
        page: &PageId,
        parent: Option<BlockId>,
        after: Option<BlockId>,
        content: &str,
    ) -> AppResult<Block>;
    async fn delete_block(&self, id: &BlockId) -> AppResult<()>;
    async fn move_block(
        &self,
        id: &BlockId,
        new_parent: Option<BlockId>,
        new_order: i64,
    ) -> AppResult<Block>;

    async fn search(&self, query: &str, limit: usize) -> AppResult<Vec<SearchHit>>;
    async fn backlinks(&self, page_name: &str) -> AppResult<Vec<Block>>;

    /// Return every block in the graph, fully populated (refs/tags/children).
    /// Used by the query engine; implementations should be reasonably cheap
    /// (cached or a single DB scan).
    async fn all_blocks(&self) -> AppResult<Vec<Block>>;

    /// Invalidate internal caches and re-index from the underlying store.
    /// Called by the filesystem watcher when external edits are detected.
    /// Default implementation is a no-op (suitable for DB-backed stores that
    /// always read through to the source of truth).
    async fn reload(&self) -> AppResult<()> {
        Ok(())
    }

    // --- Block history (version rollback) ---

    /// Return prior content snapshots for a block, newest first.
    /// Backends that cannot persist history return an empty vec.
    async fn list_block_history(
        &self,
        _block_id: &BlockId,
        _limit: usize,
    ) -> AppResult<Vec<BlockHistoryEntry>> {
        Ok(vec![])
    }

    // --- Whiteboards ---
    async fn list_whiteboards(&self) -> AppResult<Vec<WhiteboardSummary>>;
    async fn get_whiteboard(&self, id: &str) -> AppResult<Option<Whiteboard>>;
    async fn create_whiteboard(&self, name: &str) -> AppResult<Whiteboard>;
    async fn save_whiteboard(&self, id: &str, data: serde_json::Value) -> AppResult<Whiteboard>;
    async fn delete_whiteboard(&self, id: &str) -> AppResult<()>;
    async fn rename_whiteboard(&self, id: &str, new_name: &str) -> AppResult<Whiteboard>;
}

pub type DynBackend = std::sync::Arc<dyn Backend>;

/// Parse a `yyyy_mm_dd` journal name into `yyyymmdd` integer, or `None`.
pub(crate) fn fs_journal_day(name: &str) -> Option<i32> {
    let parts: Vec<&str> = name.split('_').collect();
    if parts.len() != 3 {
        return None;
    }
    let y: i32 = parts[0].parse().ok()?;
    let m: u32 = parts[1].parse().ok()?;
    let d: u32 = parts[2].parse().ok()?;
    Some(y * 10000 + (m as i32) * 100 + d as i32)
}
