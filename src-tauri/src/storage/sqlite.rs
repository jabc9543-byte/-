//! SQLite backend — single-file knowledge graph database.
//!
//! Schema (v1):
//! ```sql
//! pages    (id TEXT PK, name TEXT, journal_day INT, properties TEXT,
//!           created_at TEXT, updated_at TEXT)
//! blocks   (id TEXT PK, page_id TEXT, parent_id TEXT, ord INTEGER,
//!           content TEXT, properties TEXT, created_at TEXT, updated_at TEXT)
//! refs     (src_block TEXT, ref_kind TEXT, ref_value TEXT)
//! ```

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use chrono::Utc;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::params;

use crate::error::{AppError, AppResult};
use crate::model::{Block, BlockHistoryEntry, BlockId, Page, PageId, SearchHit, StorageKind, Whiteboard, WhiteboardSummary};
use crate::parser;

pub struct SqliteBackend {
    pool: Pool<SqliteConnectionManager>,
}

impl SqliteBackend {
    pub fn open(path: impl Into<PathBuf>) -> AppResult<Arc<Self>> {
        let path = path.into();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let manager = SqliteConnectionManager::file(&path);
        let pool = Pool::new(manager)?;
        let conn = pool.get()?;
        conn.execute_batch(SCHEMA_V1)?;
        Ok(Arc::new(Self { pool }))
    }

    fn row_to_page(row: &rusqlite::Row<'_>) -> rusqlite::Result<Page> {
        let props_json: String = row.get("properties")?;
        let properties: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&props_json).unwrap_or_default();
        let created_s: String = row.get("created_at")?;
        let updated_s: String = row.get("updated_at")?;
        Ok(Page {
            id: row.get("id")?,
            name: row.get("name")?,
            journal_day: row.get("journal_day")?,
            properties,
            created_at: created_s.parse().unwrap_or_else(|_| Utc::now()),
            updated_at: updated_s.parse().unwrap_or_else(|_| Utc::now()),
            root_block_ids: vec![],
        })
    }

    fn row_to_block(row: &rusqlite::Row<'_>) -> rusqlite::Result<Block> {
        let props_json: String = row.get("properties")?;
        let properties: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&props_json).unwrap_or_default();
        let created_s: String = row.get("created_at")?;
        let updated_s: String = row.get("updated_at")?;
        Ok(Block {
            id: row.get("id")?,
            page_id: row.get("page_id")?,
            parent_id: row.get("parent_id")?,
            order: row.get("ord")?,
            content: row.get("content")?,
            properties,
            refs_pages: vec![],
            refs_blocks: vec![],
            tags: vec![],
            children: vec![],
            task_marker: None,
            scheduled: None,
            deadline: None,
            created_at: created_s.parse().unwrap_or_else(|_| Utc::now()),
            updated_at: updated_s.parse().unwrap_or_else(|_| Utc::now()),
        })
    }

    fn reindex_refs(
        conn: &rusqlite::Connection,
        block_id: &str,
        content: &str,
    ) -> rusqlite::Result<(Vec<String>, Vec<String>, Vec<String>)> {
        let refs = parser::extract_refs(content);
        conn.execute("DELETE FROM refs WHERE src_block = ?1", params![block_id])?;
        for p in &refs.pages {
            conn.execute(
                "INSERT INTO refs(src_block, ref_kind, ref_value) VALUES (?1, 'page', ?2)",
                params![block_id, p],
            )?;
        }
        for b in &refs.blocks {
            conn.execute(
                "INSERT INTO refs(src_block, ref_kind, ref_value) VALUES (?1, 'block', ?2)",
                params![block_id, b],
            )?;
        }
        for t in &refs.tags {
            conn.execute(
                "INSERT INTO refs(src_block, ref_kind, ref_value) VALUES (?1, 'tag', ?2)",
                params![block_id, t],
            )?;
        }
        Ok((refs.pages, refs.blocks, refs.tags))
    }
}

const SCHEMA_V1: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    journal_day INTEGER,
    properties TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES blocks(id) ON DELETE CASCADE,
    ord INTEGER NOT NULL DEFAULT 0,
    content TEXT NOT NULL DEFAULT '',
    properties TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blocks_page ON blocks(page_id, parent_id, ord);

CREATE TABLE IF NOT EXISTS refs (
    src_block TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    ref_kind  TEXT NOT NULL,
    ref_value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refs_value ON refs(ref_kind, ref_value);
CREATE INDEX IF NOT EXISTS idx_refs_src ON refs(src_block);

CREATE TABLE IF NOT EXISTS whiteboards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS block_history (
    id TEXT PRIMARY KEY,
    block_id TEXT NOT NULL,
    content TEXT NOT NULL,
    edited_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_block_history_block ON block_history(block_id, recorded_at DESC);
"#;

#[async_trait]
impl super::Backend for SqliteBackend {
    fn kind(&self) -> StorageKind {
        StorageKind::Sqlite
    }

    async fn list_pages(&self) -> AppResult<Vec<Page>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare("SELECT * FROM pages ORDER BY LOWER(name)")?;
        let rows = stmt.query_map([], Self::row_to_page)?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    async fn get_page(&self, id: &PageId) -> AppResult<Option<Page>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare("SELECT * FROM pages WHERE id = ?1")?;
        let mut page = match stmt
            .query_row(params![id], Self::row_to_page)
            .optional_inline()?
        {
            Some(p) => p,
            None => return Ok(None),
        };
        let mut rs = conn.prepare(
            "SELECT id FROM blocks WHERE page_id = ?1 AND parent_id IS NULL ORDER BY ord",
        )?;
        let ids: Vec<String> = rs
            .query_map(params![id], |r| r.get::<_, String>(0))?
            .filter_map(Result::ok)
            .collect();
        page.root_block_ids = ids;
        Ok(Some(page))
    }

    async fn create_page(&self, name: &str) -> AppResult<Page> {
        let conn = self.pool.get()?;
        let id = name.trim().to_lowercase();
        let now = Utc::now().to_rfc3339();
        let journal_day = crate::storage::fs_journal_day(name);
        conn.execute(
            "INSERT INTO pages(id, name, journal_day, properties, created_at, updated_at)
             VALUES (?1, ?2, ?3, '{}', ?4, ?4)",
            params![id, name, journal_day, now],
        )?;
        let mut stmt = conn.prepare("SELECT * FROM pages WHERE id = ?1")?;
        Ok(stmt.query_row(params![id], Self::row_to_page)?)
    }

    async fn delete_page(&self, id: &PageId) -> AppResult<()> {
        let conn = self.pool.get()?;
        conn.execute("DELETE FROM pages WHERE id = ?1", params![id])?;
        Ok(())
    }

    async fn rename_page(&self, id: &PageId, new_name: &str) -> AppResult<Page> {
        let conn = self.pool.get()?;
        let new_id = new_name.trim().to_lowercase();
        let now = Utc::now().to_rfc3339();
        let tx_conn = conn;
        tx_conn.execute(
            "UPDATE pages SET id = ?1, name = ?2, updated_at = ?3 WHERE id = ?4",
            params![new_id, new_name, now, id],
        )?;
        tx_conn.execute(
            "UPDATE blocks SET page_id = ?1 WHERE page_id = ?2",
            params![new_id, id],
        )?;
        let mut stmt = tx_conn.prepare("SELECT * FROM pages WHERE id = ?1")?;
        Ok(stmt.query_row(params![new_id], Self::row_to_page)?)
    }

    async fn set_page_aliases(&self, id: &PageId, aliases: &[String]) -> AppResult<Page> {
        let conn = self.pool.get()?;
        let current_props: String = conn
            .query_row(
                "SELECT properties FROM pages WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )?;
        let mut props: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&current_props).unwrap_or_default();
        let arr: Vec<serde_json::Value> = aliases
            .iter()
            .map(|s| serde_json::Value::String(s.clone()))
            .collect();
        props.insert("aliases".to_string(), serde_json::Value::Array(arr));
        let encoded = serde_json::to_string(&props).unwrap_or_else(|_| "{}".to_string());
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE pages SET properties = ?1, updated_at = ?2 WHERE id = ?3",
            params![encoded, now, id],
        )?;
        let mut stmt = conn.prepare("SELECT * FROM pages WHERE id = ?1")?;
        Ok(stmt.query_row(params![id], Self::row_to_page)?)
    }

    async fn get_block(&self, id: &BlockId) -> AppResult<Option<Block>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare("SELECT * FROM blocks WHERE id = ?1")?;
        let mut block = match stmt
            .query_row(params![id], Self::row_to_block)
            .optional_inline()?
        {
            Some(b) => b,
            None => return Ok(None),
        };
        let mut rs = conn.prepare("SELECT id FROM blocks WHERE parent_id = ?1 ORDER BY ord")?;
        block.children = rs
            .query_map(params![id], |r| r.get::<_, String>(0))?
            .filter_map(Result::ok)
            .collect();
        let mut rs = conn.prepare("SELECT ref_kind, ref_value FROM refs WHERE src_block = ?1")?;
        for row in rs.query_map(params![id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })? {
            if let Ok((k, v)) = row {
                match k.as_str() {
                    "page" => block.refs_pages.push(v),
                    "block" => block.refs_blocks.push(v),
                    "tag" => block.tags.push(v),
                    _ => {}
                }
            }
        }
        block.task_marker = parser::extract_task_marker(&block.content);
        let (sched, dead) = parser::extract_dates(&block.content);
        block.scheduled = sched;
        block.deadline = dead;
        Ok(Some(block))
    }

    async fn update_block(&self, id: &BlockId, content: &str) -> AppResult<Block> {
        let conn = self.pool.get()?;
        let now = Utc::now().to_rfc3339();
        // Snapshot the previous content before overwriting, unless unchanged.
        let prev: Option<(String, String)> = conn
            .query_row(
                "SELECT content, updated_at FROM blocks WHERE id = ?1",
                params![id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .optional_inline()?;
        if let Some((old_content, old_updated)) = &prev {
            if old_content != content {
                let hist_id = nanoid::nanoid!();
                conn.execute(
                    "INSERT INTO block_history(id, block_id, content, edited_at, recorded_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![hist_id, id, old_content, old_updated, now],
                )?;
                // Cap per-block history at 100 most recent entries.
                conn.execute(
                    "DELETE FROM block_history WHERE block_id = ?1
                     AND id NOT IN (
                       SELECT id FROM block_history WHERE block_id = ?1
                       ORDER BY recorded_at DESC LIMIT 100
                     )",
                    params![id],
                )?;
            }
        }
        let n = conn.execute(
            "UPDATE blocks SET content = ?1, updated_at = ?2 WHERE id = ?3",
            params![content, now, id],
        )?;
        if n == 0 {
            return Err(AppError::NotFound(format!("block {id}")));
        }
        Self::reindex_refs(&conn, id, content)?;
        drop(conn);
        self.get_block(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("block {id}")))
    }

    async fn insert_block(
        &self,
        page: &PageId,
        parent: Option<BlockId>,
        after: Option<BlockId>,
        content: &str,
    ) -> AppResult<Block> {
        let conn = self.pool.get()?;
        let id = nanoid::nanoid!();
        let now = Utc::now().to_rfc3339();
        let new_order: i64 = if let Some(after_id) = &after {
            let base: i64 = conn.query_row(
                "SELECT ord FROM blocks WHERE id = ?1",
                params![after_id],
                |r| r.get(0),
            )?;
            conn.execute(
                "UPDATE blocks SET ord = ord + 1 WHERE page_id = ?1
                 AND parent_id IS ?2 AND ord > ?3",
                params![page, parent, base],
            )?;
            base + 1
        } else {
            let max: Option<i64> = conn
                .query_row(
                    "SELECT MAX(ord) FROM blocks WHERE page_id = ?1 AND parent_id IS ?2",
                    params![page, parent],
                    |r| r.get(0),
                )
                .optional_inline()?
                .flatten();
            max.map(|m| m + 1).unwrap_or(0)
        };
        conn.execute(
            "INSERT INTO blocks(id, page_id, parent_id, ord, content, properties, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, '{}', ?6, ?6)",
            params![id, page, parent, new_order, content, now],
        )?;
        Self::reindex_refs(&conn, &id, content)?;
        drop(conn);
        self.get_block(&id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("block {id}")))
    }

    async fn delete_block(&self, id: &BlockId) -> AppResult<()> {
        let conn = self.pool.get()?;
        conn.execute("DELETE FROM blocks WHERE id = ?1", params![id])?;
        Ok(())
    }

    async fn move_block(
        &self,
        id: &BlockId,
        new_parent: Option<BlockId>,
        new_order: i64,
    ) -> AppResult<Block> {
        let conn = self.pool.get()?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE blocks SET parent_id = ?1, ord = ?2, updated_at = ?3 WHERE id = ?4",
            params![new_parent, new_order, now, id],
        )?;
        drop(conn);
        self.get_block(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("block {id}")))
    }

    async fn search(&self, query: &str, limit: usize) -> AppResult<Vec<SearchHit>> {
        let conn = self.pool.get()?;
        let like = format!("%{}%", query.replace('%', r"\%"));
        let mut stmt = conn.prepare(
            "SELECT page_id, id, content FROM blocks
             WHERE content LIKE ?1 ESCAPE '\\' LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![like, limit as i64], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        let mut hits = Vec::new();
        for row in rows.flatten() {
            hits.push(SearchHit {
                page: row.0,
                block_id: row.1,
                snippet: row.2.chars().take(140).collect(),
            });
        }
        Ok(hits)
    }

    async fn backlinks(&self, page_name: &str) -> AppResult<Vec<Block>> {
        let ids: Vec<String> = {
            let conn = self.pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT DISTINCT b.id FROM blocks b
                 JOIN refs r ON r.src_block = b.id
                 WHERE r.ref_kind = 'page' AND LOWER(r.ref_value) = LOWER(?1)",
            )?;
            let rows = stmt.query_map(params![page_name], |r| r.get::<_, String>(0))?;
            let out: Vec<String> = rows.filter_map(Result::ok).collect();
            out
        };
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(b) = self.get_block(&id).await? {
                out.push(b);
            }
        }
        Ok(out)
    }

    async fn all_blocks(&self) -> AppResult<Vec<Block>> {
        let ids: Vec<String> = {
            let conn = self.pool.get()?;
            let mut stmt = conn.prepare("SELECT id FROM blocks")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            let out: Vec<String> = rows.filter_map(Result::ok).collect();
            out
        };
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(b) = self.get_block(&id).await? {
                out.push(b);
            }
        }
        Ok(out)
    }

    async fn list_whiteboards(&self) -> AppResult<Vec<WhiteboardSummary>> {
        let conn = self.pool.get()?;
        let mut stmt =
            conn.prepare("SELECT id, name, updated_at FROM whiteboards ORDER BY updated_at DESC")?;
        let rows = stmt.query_map([], |r| {
            let updated_s: String = r.get("updated_at")?;
            Ok(WhiteboardSummary {
                id: r.get("id")?,
                name: r.get("name")?,
                updated_at: updated_s.parse().unwrap_or_else(|_| Utc::now()),
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    async fn get_whiteboard(&self, id: &str) -> AppResult<Option<Whiteboard>> {
        let conn = self.pool.get()?;
        conn.query_row(
            "SELECT id, name, data, created_at, updated_at FROM whiteboards WHERE id = ?1",
            params![id],
            |r| {
                let data_s: String = r.get("data")?;
                let created_s: String = r.get("created_at")?;
                let updated_s: String = r.get("updated_at")?;
                Ok(Whiteboard {
                    id: r.get("id")?,
                    name: r.get("name")?,
                    data: serde_json::from_str(&data_s).unwrap_or(serde_json::Value::Null),
                    created_at: created_s.parse().unwrap_or_else(|_| Utc::now()),
                    updated_at: updated_s.parse().unwrap_or_else(|_| Utc::now()),
                })
            },
        )
        .optional_inline()
        .map_err(Into::into)
    }

    async fn create_whiteboard(&self, name: &str) -> AppResult<Whiteboard> {
        let id = name.trim().to_lowercase();
        if id.is_empty() {
            return Err(AppError::Other("whiteboard name cannot be empty".into()));
        }
        let conn = self.pool.get()?;
        let exists: i64 = conn.query_row(
            "SELECT COUNT(1) FROM whiteboards WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )?;
        if exists > 0 {
            return Err(AppError::Other(format!("whiteboard '{name}' already exists")));
        }
        let now = Utc::now();
        let now_s = now.to_rfc3339();
        conn.execute(
            "INSERT INTO whiteboards(id, name, data, created_at, updated_at) VALUES (?1, ?2, '{}', ?3, ?3)",
            params![id, name, now_s],
        )?;
        Ok(Whiteboard {
            id,
            name: name.to_string(),
            data: serde_json::json!({}),
            created_at: now,
            updated_at: now,
        })
    }

    async fn save_whiteboard(&self, id: &str, data: serde_json::Value) -> AppResult<Whiteboard> {
        let conn = self.pool.get()?;
        let now = Utc::now();
        let now_s = now.to_rfc3339();
        let data_s = serde_json::to_string(&data).map_err(|e| AppError::Other(e.to_string()))?;
        let rows = conn.execute(
            "UPDATE whiteboards SET data = ?1, updated_at = ?2 WHERE id = ?3",
            params![data_s, now_s, id],
        )?;
        if rows == 0 {
            // auto-create on save
            conn.execute(
                "INSERT INTO whiteboards(id, name, data, created_at, updated_at) VALUES (?1, ?1, ?2, ?3, ?3)",
                params![id, data_s, now_s],
            )?;
        }
        self.get_whiteboard(id)
            .await?
            .ok_or_else(|| AppError::Other("failed to load saved whiteboard".into()))
    }

    async fn delete_whiteboard(&self, id: &str) -> AppResult<()> {
        let conn = self.pool.get()?;
        conn.execute("DELETE FROM whiteboards WHERE id = ?1", params![id])?;
        Ok(())
    }

    async fn rename_whiteboard(&self, id: &str, new_name: &str) -> AppResult<Whiteboard> {
        let new_id = new_name.trim().to_lowercase();
        if new_id.is_empty() {
            return Err(AppError::Other("whiteboard name cannot be empty".into()));
        }
        let conn = self.pool.get()?;
        let now_s = Utc::now().to_rfc3339();
        let rows = conn.execute(
            "UPDATE whiteboards SET id = ?1, name = ?2, updated_at = ?3 WHERE id = ?4",
            params![new_id, new_name, now_s, id],
        )?;
        if rows == 0 {
            return Err(AppError::Other(format!("whiteboard '{id}' not found")));
        }
        self.get_whiteboard(&new_id)
            .await?
            .ok_or_else(|| AppError::Other("failed to load renamed whiteboard".into()))
    }

    async fn list_block_history(
        &self,
        block_id: &BlockId,
        limit: usize,
    ) -> AppResult<Vec<BlockHistoryEntry>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, block_id, content, edited_at, recorded_at FROM block_history
             WHERE block_id = ?1 ORDER BY recorded_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![block_id, limit as i64], |r| {
            let edited_s: String = r.get(3)?;
            let recorded_s: String = r.get(4)?;
            Ok(BlockHistoryEntry {
                id: r.get(0)?,
                block_id: r.get(1)?,
                content: r.get(2)?,
                edited_at: edited_s.parse().unwrap_or_else(|_| Utc::now()),
                recorded_at: recorded_s.parse().unwrap_or_else(|_| Utc::now()),
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }
}

// Helper trait to avoid churn over `optional()` method naming across rusqlite versions.
trait OptionalInline<T> {
    fn optional_inline(self) -> rusqlite::Result<Option<T>>;
}

impl<T> OptionalInline<T> for rusqlite::Result<T> {
    fn optional_inline(self) -> rusqlite::Result<Option<T>> {
        match self {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }
}
