//! Core domain model: pages, blocks, and the knowledge graph.
//!
//! Mirrors the conceptual model of Logseq: a workspace ("graph") is a tree
//! of pages; each page is an ordered tree of blocks. Blocks reference each
//! other via `[[Page Name]]` links, `#tags` and `((block-id))` embeds.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Unique block identifier (nanoid).
pub type BlockId = String;

/// A page is addressed by its normalized name (lowercase, trimmed).
pub type PageId = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StorageKind {
    /// Logseq-compatible folder of markdown files.
    Markdown,
    /// Single-file SQLite database.
    Sqlite,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphMeta {
    pub name: String,
    pub root: String,
    pub kind: StorageKind,
    pub opened_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Page {
    pub id: PageId,
    pub name: String,
    pub journal_day: Option<i32>,
    pub properties: serde_json::Map<String, serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub root_block_ids: Vec<BlockId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum TaskMarker {
    Todo,
    Doing,
    Done,
    Later,
    Now,
    Waiting,
    Cancelled,
}

impl TaskMarker {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskMarker::Todo => "TODO",
            TaskMarker::Doing => "DOING",
            TaskMarker::Done => "DONE",
            TaskMarker::Later => "LATER",
            TaskMarker::Now => "NOW",
            TaskMarker::Waiting => "WAITING",
            TaskMarker::Cancelled => "CANCELLED",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "TODO" => Self::Todo,
            "DOING" => Self::Doing,
            "DONE" => Self::Done,
            "LATER" => Self::Later,
            "NOW" => Self::Now,
            "WAITING" => Self::Waiting,
            "CANCELLED" => Self::Cancelled,
            _ => return None,
        })
    }

    /// Next marker in the canonical cycle (Logseq style):
    /// `TODO -> DOING -> DONE -> TODO`, `LATER -> NOW -> DONE -> LATER`,
    /// everything else rotates to `TODO`.
    pub fn cycle(self) -> Self {
        match self {
            Self::Todo => Self::Doing,
            Self::Doing => Self::Done,
            Self::Done => Self::Todo,
            Self::Later => Self::Now,
            Self::Now => Self::Done,
            Self::Waiting => Self::Todo,
            Self::Cancelled => Self::Todo,
        }
    }

    pub fn is_closed(&self) -> bool {
        matches!(self, Self::Done | Self::Cancelled)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Block {
    pub id: BlockId,
    pub page_id: PageId,
    pub parent_id: Option<BlockId>,
    pub order: i64,
    /// Markdown content of the block (no leading bullet).
    pub content: String,
    pub properties: serde_json::Map<String, serde_json::Value>,
    pub refs_pages: Vec<String>,
    pub refs_blocks: Vec<BlockId>,
    pub tags: Vec<String>,
    pub children: Vec<BlockId>,
    pub task_marker: Option<TaskMarker>,
    /// `YYYY-MM-DD` dates extracted from `SCHEDULED:` / `DEADLINE:` annotations.
    pub scheduled: Option<String>,
    pub deadline: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Block {
    pub fn new(page_id: PageId, parent_id: Option<BlockId>, order: i64, content: String) -> Self {
        let now = Utc::now();
        Self {
            id: nanoid::nanoid!(),
            page_id,
            parent_id,
            order,
            content,
            properties: Default::default(),
            refs_pages: vec![],
            refs_blocks: vec![],
            tags: vec![],
            children: vec![],
            task_marker: None,
            scheduled: None,
            deadline: None,
            created_at: now,
            updated_at: now,
        }
    }
}

/// A recorded prior version of a block's content. Captured automatically
/// by the storage layer immediately before a mutation overwrites the
/// block's content, so the full edit timeline can be browsed and restored.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockHistoryEntry {
    /// Stable identifier for this particular history entry (nanoid).
    pub id: String,
    pub block_id: BlockId,
    /// The content of the block as of `edited_at` (i.e. the snapshot's content).
    pub content: String,
    /// Block's `updated_at` at the moment the snapshot was captured.
    pub edited_at: DateTime<Utc>,
    /// Wall-clock time the snapshot row was written.
    pub recorded_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub page: String,
    pub block_id: BlockId,
    pub snippet: String,
}

/// A free-form visual canvas (tldraw document). Stored opaquely as JSON;
/// the frontend owns the schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Whiteboard {
    pub id: String,
    pub name: String,
    pub data: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Lightweight summary used by sidebar listings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhiteboardSummary {
    pub id: String,
    pub name: String,
    pub updated_at: DateTime<Utc>,
}
