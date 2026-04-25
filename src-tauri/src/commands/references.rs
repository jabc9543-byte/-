//! Backlink & block-reference panel commands (module 24).
//!
//! These augment the existing flat `backlinks(page)` command with the shape
//! the live-preview panel needs:
//!
//! * `backlinks_grouped(page)` — groups hits by their source page and attaches
//!   the ancestor chain of each hit so the sidebar can render breadcrumbs.
//! * `block_refs(id)` — reverse block-level references (i.e. blocks whose
//!   content contains `((id))`).
//! * `block_context(id)` — fetches a block together with its page, ancestors
//!   and direct children, used to render the hover preview card.

use std::collections::HashSet;

use serde::Serialize;
use tauri::State;

use crate::error::AppResult;
use crate::model::{Block, BlockId, Page};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct BacklinkHit {
    /// The referring block itself.
    pub block: Block,
    /// Root→parent chain of the block (excluding the block itself).
    pub ancestors: Vec<Block>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BacklinkGroup {
    pub page_id: String,
    pub page_name: String,
    pub is_journal: bool,
    pub hits: Vec<BacklinkHit>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BlockContext {
    pub block: Block,
    pub page: Option<Page>,
    pub ancestors: Vec<Block>,
    pub children: Vec<Block>,
}

/// Page-level backlinks, grouped by source page and enriched with the
/// ancestor chain of each hit.
#[tauri::command]
pub async fn backlinks_grouped(
    page: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<BacklinkGroup>> {
    let backend = state.current()?.backend.clone();

    // Reuse the canonical alias resolution from `commands::search::backlinks`.
    // Duplicated locally to avoid cyclic command imports.
    let mut candidates: Vec<String> = vec![page.clone()];
    for p in backend.list_pages().await? {
        if p.name.eq_ignore_ascii_case(&page) {
            if let Some(serde_json::Value::Array(arr)) = p.properties.get("aliases") {
                for v in arr {
                    if let Some(s) = v.as_str() {
                        candidates.push(s.to_string());
                    }
                }
            }
            break;
        }
        if let Some(serde_json::Value::Array(arr)) = p.properties.get("aliases") {
            if arr.iter().any(|v| {
                v.as_str()
                    .map(|s| s.eq_ignore_ascii_case(&page))
                    .unwrap_or(false)
            }) {
                candidates.push(p.name.clone());
                for v in arr {
                    if let Some(s) = v.as_str() {
                        candidates.push(s.to_string());
                    }
                }
                break;
            }
        }
    }

    let mut seen = HashSet::new();
    let mut hits: Vec<Block> = Vec::new();
    for name in &candidates {
        for b in backend.backlinks(name).await? {
            if seen.insert(b.id.clone()) {
                hits.push(b);
            }
        }
    }

    build_groups(&backend, hits).await
}

/// Reverse block-level refs: every block that mentions `((id))`.
#[tauri::command]
pub async fn block_refs(
    id: BlockId,
    state: State<'_, AppState>,
) -> AppResult<Vec<BacklinkGroup>> {
    let backend = state.current()?.backend.clone();
    let all = backend.all_blocks().await?;
    let hits: Vec<Block> = all
        .into_iter()
        .filter(|b| b.refs_blocks.iter().any(|r| r == &id))
        .collect();
    build_groups(&backend, hits).await
}

/// Full context for a single block (used by the hover preview).
#[tauri::command]
pub async fn block_context(
    id: BlockId,
    state: State<'_, AppState>,
) -> AppResult<Option<BlockContext>> {
    let backend = state.current()?.backend.clone();
    let Some(block) = backend.get_block(&id).await? else {
        return Ok(None);
    };
    let page = backend.get_page(&block.page_id).await?;
    let ancestors = ancestor_chain(&backend, &block).await?;
    let mut children = Vec::new();
    for cid in &block.children {
        if let Some(c) = backend.get_block(cid).await? {
            children.push(c);
        }
    }
    children.sort_by_key(|c| c.order);
    Ok(Some(BlockContext {
        block,
        page,
        ancestors,
        children,
    }))
}

// --- helpers ---------------------------------------------------------------

async fn ancestor_chain(
    backend: &crate::storage::DynBackend,
    block: &Block,
) -> AppResult<Vec<Block>> {
    let mut chain = Vec::new();
    let mut cur = block.parent_id.clone();
    // Hard guard against pathological cycles.
    for _ in 0..64 {
        let Some(pid) = cur else { break };
        let Some(parent) = backend.get_block(&pid).await? else {
            break;
        };
        cur = parent.parent_id.clone();
        chain.push(parent);
    }
    chain.reverse();
    Ok(chain)
}

async fn build_groups(
    backend: &crate::storage::DynBackend,
    hits: Vec<Block>,
) -> AppResult<Vec<BacklinkGroup>> {
    use std::collections::BTreeMap;

    // Pre-fetch page metadata for the pages touched by the hits.
    let mut page_cache: BTreeMap<String, Option<Page>> = BTreeMap::new();
    for b in &hits {
        if !page_cache.contains_key(&b.page_id) {
            let p = backend.get_page(&b.page_id).await?;
            page_cache.insert(b.page_id.clone(), p);
        }
    }

    let mut by_page: BTreeMap<String, BacklinkGroup> = BTreeMap::new();
    for b in hits {
        let ancestors = ancestor_chain(backend, &b).await?;
        let page = page_cache.get(&b.page_id).cloned().flatten();
        let page_name = page
            .as_ref()
            .map(|p| p.name.clone())
            .unwrap_or_else(|| b.page_id.clone());
        let is_journal = page.as_ref().and_then(|p| p.journal_day).is_some();
        let entry = by_page
            .entry(b.page_id.clone())
            .or_insert_with(|| BacklinkGroup {
                page_id: b.page_id.clone(),
                page_name: page_name.clone(),
                is_journal,
                hits: Vec::new(),
            });
        entry.hits.push(BacklinkHit {
            block: b,
            ancestors,
        });
    }

    // Sort: journal pages newest-first, then everything else by name.
    let mut groups: Vec<BacklinkGroup> = by_page.into_values().collect();
    groups.sort_by(|a, b| match (a.is_journal, b.is_journal) {
        (true, true) => b.page_id.cmp(&a.page_id),
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        (false, false) => a.page_name.to_lowercase().cmp(&b.page_name.to_lowercase()),
    });
    // Also sort hits within each group by order so parents appear before
    // their children when both reference the same page.
    for g in &mut groups {
        g.hits.sort_by(|x, y| x.block.order.cmp(&y.block.order));
    }
    Ok(groups)
}
