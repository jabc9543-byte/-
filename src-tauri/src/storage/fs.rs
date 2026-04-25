//! Filesystem backend: a folder of Markdown files (Logseq-compatible layout).
//!
//! Layout:
//! ```text
//! graph-root/
//!   pages/<page-name>.md
//!   journals/<yyyy_mm_dd>.md
//!   logseq/config.edn        (optional; ignored)
//!   assets/                  (optional; ignored)
//! ```
//!
//! Blocks are represented in-memory: each page file is parsed into a block tree
//! on demand, and serialized back on mutation. An in-memory LRU-ish cache keyed
//! by page id holds the parsed blocks until a write invalidates the page.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use chrono::Utc;
use parking_lot::RwLock;

use crate::error::{AppError, AppResult};
use crate::model::{Block, BlockHistoryEntry, BlockId, Page, PageId, SearchHit, StorageKind, Whiteboard, WhiteboardSummary};
use crate::parser;

pub struct FsBackend {
    root: PathBuf,
    cache: RwLock<HashMap<PageId, Vec<Block>>>, // page -> parsed blocks
    pages: RwLock<HashMap<PageId, Page>>,       // page metadata cache
}

impl FsBackend {
    pub fn open(root: impl Into<PathBuf>) -> AppResult<Arc<Self>> {
        let root = root.into();
        std::fs::create_dir_all(root.join("pages"))?;
        std::fs::create_dir_all(root.join("journals"))?;
        let backend = Arc::new(Self {
            root,
            cache: Default::default(),
            pages: Default::default(),
        });
        backend.rescan()?;
        Ok(backend)
    }

    fn rescan(&self) -> AppResult<()> {
        let mut pages = self.pages.write();
        pages.clear();
        for sub in ["pages", "journals"] {
            let dir = self.root.join(sub);
            if !dir.exists() {
                continue;
            }
            for entry in walkdir::WalkDir::new(&dir).max_depth(1) {
                let entry = entry.map_err(|e| AppError::Other(e.to_string()))?;
                if !entry.file_type().is_file() {
                    continue;
                }
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) != Some("md") {
                    continue;
                }
                let name = path.file_stem().unwrap().to_string_lossy().to_string();
                let id = normalize_page_id(&name);
                let md = std::fs::metadata(path)?;
                let created_at = md
                    .created()
                    .ok()
                    .map(chrono::DateTime::<Utc>::from)
                    .unwrap_or_else(Utc::now);
                let updated_at = md
                    .modified()
                    .ok()
                    .map(chrono::DateTime::<Utc>::from)
                    .unwrap_or_else(Utc::now);
                pages.insert(
                    id.clone(),
                    Page {
                        id,
                        name: human_page_name(&name),
                        journal_day: journal_day_from_name(&name),
                        properties: Default::default(),
                        created_at,
                        updated_at,
                        root_block_ids: vec![],
                    },
                );
            }
        }
        Ok(())
    }

    fn path_for(&self, id: &PageId) -> PathBuf {
        let pages = self.pages.read();
        let name = pages
            .get(id)
            .map(|p| p.name.clone())
            .unwrap_or_else(|| id.clone());
        let sub = if journal_day_from_name(&name).is_some() {
            "journals"
        } else {
            "pages"
        };
        self.root.join(sub).join(format!("{}.md", file_name_from_page_name(&name)))
    }

    fn load_page_blocks(&self, id: &PageId) -> AppResult<Vec<Block>> {
        if let Some(cached) = self.cache.read().get(id).cloned() {
            return Ok(cached);
        }
        let path = self.path_for(id);
        let body = if path.exists() {
            std::fs::read_to_string(&path)?
        } else {
            String::new()
        };
        let blocks = parser::parse_page_markdown(id, &body);
        self.cache.write().insert(id.clone(), blocks.clone());
        Ok(blocks)
    }

    fn save_page_blocks(&self, id: &PageId, blocks: &[Block]) -> AppResult<()> {
        let body = parser::render_page_markdown(blocks);
        let path = self.path_for(id);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, body)?;
        self.cache.write().insert(id.clone(), blocks.to_vec());
        if let Some(p) = self.pages.write().get_mut(id) {
            p.updated_at = Utc::now();
        }
        Ok(())
    }

    fn history_path(&self) -> PathBuf {
        self.root.join("logseq").join("block-history.jsonl")
    }

    fn append_history_entry(&self, entry: &BlockHistoryEntry) -> AppResult<()> {
        use std::io::Write;
        let path = self.history_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
        let line = serde_json::to_string(entry)?;
        writeln!(f, "{line}")?;
        Ok(())
    }
}

#[async_trait]
impl super::Backend for FsBackend {
    fn kind(&self) -> StorageKind {
        StorageKind::Markdown
    }

    async fn list_pages(&self) -> AppResult<Vec<Page>> {
        let mut v: Vec<Page> = self.pages.read().values().cloned().collect();
        v.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(v)
    }

    async fn get_page(&self, id: &PageId) -> AppResult<Option<Page>> {
        let Some(mut page) = self.pages.read().get(id).cloned() else {
            return Ok(None);
        };
        let blocks = self.load_page_blocks(id)?;
        page.root_block_ids = blocks
            .iter()
            .filter(|b| b.parent_id.is_none())
            .map(|b| b.id.clone())
            .collect();
        Ok(Some(page))
    }

    async fn create_page(&self, name: &str) -> AppResult<Page> {
        let id = normalize_page_id(name);
        if self.pages.read().contains_key(&id) {
            return Err(AppError::Invalid(format!("page '{name}' already exists")));
        }
        let now = Utc::now();
        let page = Page {
            id: id.clone(),
            name: name.to_string(),
            journal_day: journal_day_from_name(name),
            properties: Default::default(),
            created_at: now,
            updated_at: now,
            root_block_ids: vec![],
        };
        self.pages.write().insert(id.clone(), page.clone());
        self.save_page_blocks(&id, &[])?;
        Ok(page)
    }

    async fn delete_page(&self, id: &PageId) -> AppResult<()> {
        let path = self.path_for(id);
        if path.exists() {
            std::fs::remove_file(&path)?;
        }
        self.pages.write().remove(id);
        self.cache.write().remove(id);
        Ok(())
    }

    async fn rename_page(&self, id: &PageId, new_name: &str) -> AppResult<Page> {
        let blocks = self.load_page_blocks(id)?;
        let old_path = self.path_for(id);
        if old_path.exists() {
            std::fs::remove_file(&old_path)?;
        }
        let new_id = normalize_page_id(new_name);
        let mut pages = self.pages.write();
        let mut page = pages
            .remove(id)
            .ok_or_else(|| AppError::NotFound(format!("page {id}")))?;
        page.id = new_id.clone();
        page.name = new_name.to_string();
        page.updated_at = Utc::now();
        pages.insert(new_id.clone(), page.clone());
        drop(pages);
        self.cache.write().remove(id);
        let retargeted: Vec<Block> = blocks
            .into_iter()
            .map(|mut b| {
                b.page_id = new_id.clone();
                b
            })
            .collect();
        self.save_page_blocks(&new_id, &retargeted)?;
        Ok(page)
    }

    async fn set_page_aliases(&self, id: &PageId, aliases: &[String]) -> AppResult<Page> {
        // FS backend keeps page properties in memory only; persistence across
        // restarts of the fs graph is a separate concern (Logseq stores
        // `alias::` inline in the page markdown — future work).
        let mut pages = self.pages.write();
        let page = pages
            .get_mut(id)
            .ok_or_else(|| AppError::NotFound(format!("page {id}")))?;
        let arr: Vec<serde_json::Value> = aliases
            .iter()
            .map(|s| serde_json::Value::String(s.clone()))
            .collect();
        page.properties
            .insert("aliases".to_string(), serde_json::Value::Array(arr));
        page.updated_at = Utc::now();
        Ok(page.clone())
    }

    async fn get_block(&self, id: &BlockId) -> AppResult<Option<Block>> {
        let pages: Vec<PageId> = self.pages.read().keys().cloned().collect();
        for p in pages {
            let blocks = self.load_page_blocks(&p)?;
            if let Some(b) = blocks.into_iter().find(|b| &b.id == id) {
                return Ok(Some(b));
            }
        }
        Ok(None)
    }

    async fn update_block(&self, id: &BlockId, content: &str) -> AppResult<Block> {
        let block = self
            .get_block(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("block {id}")))?;
        let mut blocks = self.load_page_blocks(&block.page_id)?;
        let idx = blocks
            .iter()
            .position(|b| &b.id == id)
            .ok_or_else(|| AppError::NotFound(format!("block {id}")))?;
        // Snapshot previous content before overwriting, unless unchanged.
        if blocks[idx].content != content {
            let prev_entry = BlockHistoryEntry {
                id: nanoid::nanoid!(),
                block_id: id.clone(),
                content: blocks[idx].content.clone(),
                edited_at: blocks[idx].updated_at,
                recorded_at: Utc::now(),
            };
            if let Err(e) = self.append_history_entry(&prev_entry) {
                tracing::warn!("failed to append block history: {e}");
            }
        }
        blocks[idx].content = content.to_string();
        blocks[idx].updated_at = Utc::now();
        parser::annotate_block(&mut blocks[idx]);
        let page_id = blocks[idx].page_id.clone();
        let out = blocks[idx].clone();
        self.save_page_blocks(&page_id, &blocks)?;
        Ok(out)
    }

    async fn insert_block(
        &self,
        page: &PageId,
        parent: Option<BlockId>,
        after: Option<BlockId>,
        content: &str,
    ) -> AppResult<Block> {
        let mut blocks = self.load_page_blocks(page)?;
        let mut new_block = Block::new(page.clone(), parent.clone(), 0, content.to_string());
        parser::annotate_block(&mut new_block);

        // Resolve order.
        let siblings: Vec<usize> = blocks
            .iter()
            .enumerate()
            .filter(|(_, b)| b.parent_id == parent)
            .map(|(i, _)| i)
            .collect();
        let new_order = if let Some(after_id) = &after {
            let base = blocks
                .iter()
                .find(|b| &b.id == after_id)
                .map(|b| b.order)
                .unwrap_or(0);
            for i in &siblings {
                if blocks[*i].order > base {
                    blocks[*i].order += 1;
                }
            }
            base + 1
        } else {
            siblings
                .iter()
                .map(|i| blocks[*i].order)
                .max()
                .map(|m| m + 1)
                .unwrap_or(0)
        };
        new_block.order = new_order;

        if let Some(p) = &parent {
            if let Some(pb) = blocks.iter_mut().find(|b| &b.id == p) {
                pb.children.push(new_block.id.clone());
            }
        }
        let out = new_block.clone();
        blocks.push(new_block);
        self.save_page_blocks(page, &blocks)?;
        Ok(out)
    }

    async fn delete_block(&self, id: &BlockId) -> AppResult<()> {
        let block = self
            .get_block(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("block {id}")))?;
        let mut blocks = self.load_page_blocks(&block.page_id)?;
        // Remove block and all descendants.
        let mut to_remove = std::collections::HashSet::new();
        to_remove.insert(id.clone());
        loop {
            let n = to_remove.len();
            for b in &blocks {
                if let Some(p) = &b.parent_id {
                    if to_remove.contains(p) {
                        to_remove.insert(b.id.clone());
                    }
                }
            }
            if to_remove.len() == n {
                break;
            }
        }
        blocks.retain(|b| !to_remove.contains(&b.id));
        for b in blocks.iter_mut() {
            b.children.retain(|c| !to_remove.contains(c));
        }
        self.save_page_blocks(&block.page_id, &blocks)?;
        Ok(())
    }

    async fn move_block(
        &self,
        id: &BlockId,
        new_parent: Option<BlockId>,
        new_order: i64,
    ) -> AppResult<Block> {
        let block = self
            .get_block(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("block {id}")))?;
        let mut blocks = self.load_page_blocks(&block.page_id)?;
        for b in blocks.iter_mut() {
            b.children.retain(|c| c != id);
        }
        if let Some(p) = &new_parent {
            if let Some(pb) = blocks.iter_mut().find(|b| &b.id == p) {
                pb.children.push(id.clone());
            }
        }
        let idx = blocks.iter().position(|b| &b.id == id).unwrap();
        blocks[idx].parent_id = new_parent;
        blocks[idx].order = new_order;
        blocks[idx].updated_at = Utc::now();
        let out = blocks[idx].clone();
        let page_id = blocks[idx].page_id.clone();
        self.save_page_blocks(&page_id, &blocks)?;
        Ok(out)
    }

    async fn search(&self, query: &str, limit: usize) -> AppResult<Vec<SearchHit>> {
        let q = query.to_lowercase();
        let mut hits = Vec::new();
        let page_ids: Vec<PageId> = self.pages.read().keys().cloned().collect();
        for pid in page_ids {
            let blocks = self.load_page_blocks(&pid)?;
            for b in blocks {
                if b.content.to_lowercase().contains(&q) {
                    hits.push(SearchHit {
                        page: pid.clone(),
                        block_id: b.id.clone(),
                        snippet: make_snippet(&b.content, &q),
                    });
                    if hits.len() >= limit {
                        return Ok(hits);
                    }
                }
            }
        }
        Ok(hits)
    }

    async fn backlinks(&self, page_name: &str) -> AppResult<Vec<Block>> {
        let target = page_name.to_string();
        let mut out = Vec::new();
        let ids: Vec<PageId> = self.pages.read().keys().cloned().collect();
        for pid in ids {
            for b in self.load_page_blocks(&pid)? {
                if b.refs_pages.iter().any(|p| p.eq_ignore_ascii_case(&target)) {
                    out.push(b);
                }
            }
        }
        Ok(out)
    }

    async fn all_blocks(&self) -> AppResult<Vec<Block>> {
        let mut out = Vec::new();
        let ids: Vec<PageId> = self.pages.read().keys().cloned().collect();
        for pid in ids {
            out.extend(self.load_page_blocks(&pid)?);
        }
        Ok(out)
    }

    async fn reload(&self) -> AppResult<()> {
        // Drop cached parsed blocks; metadata is rebuilt by rescan.
        self.cache.write().clear();
        self.rescan()?;
        Ok(())
    }

    async fn list_whiteboards(&self) -> AppResult<Vec<WhiteboardSummary>> {
        let dir = self.root.join("whiteboards");
        if !dir.exists() {
            return Ok(vec![]);
        }
        let mut out = Vec::new();
        for entry in walkdir::WalkDir::new(&dir).max_depth(1) {
            let entry = entry.map_err(|e| AppError::Other(e.to_string()))?;
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("tldr") {
                continue;
            }
            let name = path.file_stem().unwrap().to_string_lossy().to_string();
            let md = std::fs::metadata(path)?;
            let updated_at = md
                .modified()
                .ok()
                .map(chrono::DateTime::<Utc>::from)
                .unwrap_or_else(Utc::now);
            out.push(WhiteboardSummary {
                id: name.clone(),
                name,
                updated_at,
            });
        }
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(out)
    }

    async fn get_whiteboard(&self, id: &str) -> AppResult<Option<Whiteboard>> {
        let path = self.root.join("whiteboards").join(format!("{id}.tldr"));
        if !path.exists() {
            return Ok(None);
        }
        let bytes = std::fs::read(&path)?;
        let data: serde_json::Value = if bytes.is_empty() {
            serde_json::Value::Null
        } else {
            serde_json::from_slice(&bytes).map_err(|e| AppError::Other(e.to_string()))?
        };
        let md = std::fs::metadata(&path)?;
        let created_at = md
            .created()
            .ok()
            .map(chrono::DateTime::<Utc>::from)
            .unwrap_or_else(Utc::now);
        let updated_at = md
            .modified()
            .ok()
            .map(chrono::DateTime::<Utc>::from)
            .unwrap_or_else(Utc::now);
        Ok(Some(Whiteboard {
            id: id.to_string(),
            name: id.to_string(),
            data,
            created_at,
            updated_at,
        }))
    }

    async fn create_whiteboard(&self, name: &str) -> AppResult<Whiteboard> {
        let dir = self.root.join("whiteboards");
        std::fs::create_dir_all(&dir)?;
        let id = normalize_page_id(name);
        let path = dir.join(format!("{id}.tldr"));
        if path.exists() {
            return Err(AppError::Other(format!("whiteboard '{name}' already exists")));
        }
        let data = serde_json::json!({});
        std::fs::write(&path, serde_json::to_vec_pretty(&data).unwrap())?;
        let now = Utc::now();
        Ok(Whiteboard {
            id,
            name: name.to_string(),
            data,
            created_at: now,
            updated_at: now,
        })
    }

    async fn save_whiteboard(&self, id: &str, data: serde_json::Value) -> AppResult<Whiteboard> {
        let dir = self.root.join("whiteboards");
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(format!("{id}.tldr"));
        std::fs::write(
            &path,
            serde_json::to_vec_pretty(&data).map_err(|e| AppError::Other(e.to_string()))?,
        )?;
        let md = std::fs::metadata(&path)?;
        let created_at = md
            .created()
            .ok()
            .map(chrono::DateTime::<Utc>::from)
            .unwrap_or_else(Utc::now);
        let updated_at = md
            .modified()
            .ok()
            .map(chrono::DateTime::<Utc>::from)
            .unwrap_or_else(Utc::now);
        Ok(Whiteboard {
            id: id.to_string(),
            name: id.to_string(),
            data,
            created_at,
            updated_at,
        })
    }

    async fn delete_whiteboard(&self, id: &str) -> AppResult<()> {
        let path = self.root.join("whiteboards").join(format!("{id}.tldr"));
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }

    async fn rename_whiteboard(&self, id: &str, new_name: &str) -> AppResult<Whiteboard> {
        let dir = self.root.join("whiteboards");
        let from = dir.join(format!("{id}.tldr"));
        let new_id = normalize_page_id(new_name);
        let to = dir.join(format!("{new_id}.tldr"));
        if !from.exists() {
            return Err(AppError::Other(format!("whiteboard '{id}' not found")));
        }
        if to.exists() {
            return Err(AppError::Other(format!("whiteboard '{new_name}' already exists")));
        }
        std::fs::rename(&from, &to)?;
        self.get_whiteboard(&new_id)
            .await?
            .ok_or_else(|| AppError::Other("failed to load renamed whiteboard".into()))
    }

    async fn list_block_history(
        &self,
        block_id: &BlockId,
        limit: usize,
    ) -> AppResult<Vec<BlockHistoryEntry>> {
        let path = self.history_path();
        if !path.exists() {
            return Ok(vec![]);
        }
        let raw = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => return Ok(vec![]),
        };
        let mut out: Vec<BlockHistoryEntry> = raw
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str::<BlockHistoryEntry>(l).ok())
            .filter(|e| e.block_id == *block_id)
            .collect();
        out.sort_by(|a, b| b.recorded_at.cmp(&a.recorded_at));
        out.truncate(limit);
        Ok(out)
    }
}

fn normalize_page_id(name: &str) -> PageId {
    name.trim().to_lowercase()
}

fn human_page_name(file_stem: &str) -> String {
    // Logseq escapes `/` as `___` in file names; reverse that.
    file_stem.replace("___", "/")
}

fn file_name_from_page_name(name: &str) -> String {
    name.replace('/', "___")
}

fn journal_day_from_name(name: &str) -> Option<i32> {
    // Accept `yyyy_mm_dd` (Logseq default).
    let parts: Vec<&str> = name.split('_').collect();
    if parts.len() != 3 {
        return None;
    }
    let y: i32 = parts[0].parse().ok()?;
    let m: u32 = parts[1].parse().ok()?;
    let d: u32 = parts[2].parse().ok()?;
    Some(y * 10000 + (m as i32) * 100 + d as i32)
}

fn make_snippet(content: &str, q: &str) -> String {
    let lc = content.to_lowercase();
    let Some(pos) = lc.find(q) else {
        return content.chars().take(80).collect();
    };
    let start = pos.saturating_sub(30);
    let end = (pos + q.len() + 30).min(content.len());
    let mut s = String::new();
    if start > 0 {
        s.push('…');
    }
    s.push_str(&content[start..end]);
    if end < content.len() {
        s.push('…');
    }
    s
}

#[allow(dead_code)]
fn _assert_path_unused(_: &Path) {}
