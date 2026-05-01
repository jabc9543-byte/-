//! Graph import / export commands.
//!
//! Two formats are supported:
//! * `markdown` — a folder of `pages/*.md` and `journals/*.md`, matching the
//!   Logseq-compatible filesystem layout. Always packaged as a ZIP archive for
//!   portability.
//! * `json`     — a single JSON document containing all pages, blocks and
//!   whiteboards, suitable for programmatic reuse.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

use crate::error::{AppError, AppResult};
use crate::model::{Block, Page, PageId, Whiteboard};
use crate::parser;
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct GraphDump {
    pub version: u32,
    pub pages: Vec<Page>,
    pub blocks: Vec<Block>,
    pub whiteboards: Vec<Whiteboard>,
}

#[derive(Debug, Serialize)]
pub struct ExportReport {
    pub path: String,
    pub pages: usize,
    pub blocks: usize,
    pub whiteboards: usize,
}

#[derive(Debug, Serialize)]
pub struct ImportReport {
    pub pages: usize,
    pub blocks: usize,
}

/// Export the whole graph to a ZIP archive of markdown files.
#[tauri::command]
pub async fn export_markdown(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<ExportReport> {
    let graph = state.current()?;
    let pages = graph.backend.list_pages().await?;
    let blocks = graph.backend.all_blocks().await?;
    let whiteboards = graph.backend.list_whiteboards().await?;

    // Group blocks by page id.
    let mut by_page: HashMap<PageId, Vec<Block>> = HashMap::new();
    for b in blocks.iter() {
        by_page.entry(b.page_id.clone()).or_default().push(b.clone());
    }

    let dest = PathBuf::from(&path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file = File::create(&dest)?;
    let mut zip = ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let mut block_count = 0usize;
    for page in &pages {
        let mut page_blocks = by_page.remove(&page.id).unwrap_or_default();
        page_blocks.sort_by_key(|b| (b.parent_id.clone(), b.order));
        block_count += page_blocks.len();
        let md = parser::render_page_markdown(&page_blocks);
        let sub = if page.journal_day.is_some() { "journals" } else { "pages" };
        let fname = sanitize_filename(&page.name);
        zip.start_file(format!("{sub}/{fname}.md"), opts)
            .map_err(ze)?;
        zip.write_all(md.as_bytes())?;
    }

    for wb in whiteboards.iter() {
        let full = graph.backend.get_whiteboard(&wb.id).await?;
        if let Some(full) = full {
            zip.start_file(format!("whiteboards/{}.tldr", sanitize_filename(&full.name)), opts)
                .map_err(ze)?;
            let bytes = serde_json::to_vec_pretty(&full.data)?;
            zip.write_all(&bytes)?;
        }
    }

    zip.finish().map_err(ze)?;

    Ok(ExportReport {
        path: dest.to_string_lossy().into_owned(),
        pages: pages.len(),
        blocks: block_count,
        whiteboards: whiteboards.len(),
    })
}

/// Export the graph as a single JSON document.
#[tauri::command]
pub async fn export_json(path: String, state: State<'_, AppState>) -> AppResult<ExportReport> {
    let graph = state.current()?;
    let pages = graph.backend.list_pages().await?;
    let blocks = graph.backend.all_blocks().await?;
    let summaries = graph.backend.list_whiteboards().await?;
    let mut whiteboards = Vec::with_capacity(summaries.len());
    for s in &summaries {
        if let Some(wb) = graph.backend.get_whiteboard(&s.id).await? {
            whiteboards.push(wb);
        }
    }
    let dump = GraphDump {
        version: 1,
        pages: pages.clone(),
        blocks: blocks.clone(),
        whiteboards: whiteboards.clone(),
    };
    let dest = PathBuf::from(&path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec_pretty(&dump)?;
    std::fs::write(&dest, bytes)?;
    Ok(ExportReport {
        path: dest.to_string_lossy().into_owned(),
        pages: pages.len(),
        blocks: blocks.len(),
        whiteboards: whiteboards.len(),
    })
}

/// Import markdown pages from a folder or ZIP archive into the current graph.
/// Existing pages with the same name are overwritten.
#[tauri::command]
pub async fn import_markdown(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<ImportReport> {
    let graph = state.current()?;
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(AppError::NotFound(path));
    }

    let entries = if src.is_file()
        && src
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case("zip"))
            .unwrap_or(false)
    {
        read_zip_markdown(&src)?
    } else {
        read_dir_markdown(&src)?
    };

    import_markdown_entries(&graph, entries).await
}

#[tauri::command]
pub async fn import_markdown_file(
    name: String,
    content: String,
    state: State<'_, AppState>,
) -> AppResult<ImportReport> {
    let graph = state.current()?;
    let page_name = Path::new(&name)
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("page")
        .to_string();
    import_markdown_entries(&graph, vec![(page_name, content)]).await
}

async fn import_markdown_entries(
    graph: &crate::graph::Graph,
    entries: Vec<(String, String)>,
) -> AppResult<ImportReport> {
    let mut page_count = 0usize;
    let mut block_count = 0usize;
    for (name, body) in entries {
        let page = graph.backend.create_page(&name).await?;
        let parsed = parser::parse_page_markdown(&page.id, &body);
        let mut id_map: HashMap<String, String> = HashMap::new();
        for b in &parsed {
            let parent = b
                .parent_id
                .as_deref()
                .and_then(|pid| id_map.get(pid).cloned());
            let inserted = graph
                .backend
                .insert_block(&page.id, parent, None, &b.content)
                .await?;
            id_map.insert(b.id.clone(), inserted.id);
            block_count += 1;
        }
        page_count += 1;
    }

    graph.rebuild_search_index().await?;
    Ok(ImportReport {
        pages: page_count,
        blocks: block_count,
    })
}

fn read_dir_markdown(root: &Path) -> AppResult<Vec<(String, String)>> {
    let mut out = Vec::new();
    for sub in ["pages", "journals"] {
        let dir = root.join(sub);
        if !dir.exists() {
            continue;
        }
        for entry in walkdir::WalkDir::new(&dir).max_depth(1) {
            let entry = entry.map_err(|e| AppError::Other(e.to_string()))?;
            if !entry.file_type().is_file() {
                continue;
            }
            let p = entry.path();
            if p.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            let name = p.file_stem().unwrap().to_string_lossy().into_owned();
            let body = std::fs::read_to_string(p)?;
            out.push((name, body));
        }
    }
    Ok(out)
}

fn read_zip_markdown(src: &Path) -> AppResult<Vec<(String, String)>> {
    let file = File::open(src)?;
    let mut zip = ZipArchive::new(file).map_err(ze)?;
    let mut out = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(ze)?;
        if !entry.is_file() {
            continue;
        }
        let name = entry.name().to_string();
        if !(name.starts_with("pages/") || name.starts_with("journals/")) {
            continue;
        }
        if !name.ends_with(".md") {
            continue;
        }
        let stem = Path::new(&name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("page")
            .to_string();
        let mut body = String::new();
        entry.read_to_string(&mut body)?;
        out.push((stem, body));
    }
    Ok(out)
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect()
}

fn ze(e: zip::result::ZipError) -> AppError {
    AppError::Other(format!("zip: {e}"))
}

// ---------------------------------------------------------------------------
// Module 17 additions: JSON import, OPML import/export, single-page markdown
// ---------------------------------------------------------------------------

/// Import a `GraphDump` JSON document (produced by `export_json`).
/// Pages are recreated by name, blocks are re-inserted preserving tree order,
/// and whiteboards are overwritten (matched by name).
#[tauri::command]
pub async fn import_json(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<ImportReport> {
    let graph = state.current()?;
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(AppError::NotFound(path));
    }
    let bytes = std::fs::read(&src)?;
    let dump: GraphDump = serde_json::from_slice(&bytes)?;

    // Group blocks by page and index by id so we can walk the tree top-down.
    let mut by_page: HashMap<PageId, Vec<Block>> = HashMap::new();
    for b in dump.blocks.iter().cloned() {
        by_page.entry(b.page_id.clone()).or_default().push(b);
    }

    let mut page_count = 0usize;
    let mut block_count = 0usize;
    for page in &dump.pages {
        let new_page = graph.backend.create_page(&page.name).await?;
        let mut blocks = by_page.remove(&page.id).unwrap_or_default();
        blocks.sort_by_key(|b| (b.parent_id.clone(), b.order));
        let mut id_map: HashMap<String, String> = HashMap::new();
        // Multiple passes so a block referencing a parent that appears later
        // in `blocks` (should not happen with proper sort but be safe) still
        // resolves. Two passes over the list are enough for a DAG-free tree.
        for _ in 0..2 {
            for b in &blocks {
                if id_map.contains_key(&b.id) {
                    continue;
                }
                let parent = match b.parent_id.as_deref() {
                    Some(pid) => match id_map.get(pid) {
                        Some(mapped) => Some(mapped.clone()),
                        None => continue, // parent not yet inserted, retry
                    },
                    None => None,
                };
                let inserted = graph
                    .backend
                    .insert_block(&new_page.id, parent, None, &b.content)
                    .await?;
                id_map.insert(b.id.clone(), inserted.id);
                block_count += 1;
            }
        }
        page_count += 1;
    }

    // Whiteboards: re-create or overwrite by name.
    let existing = graph.backend.list_whiteboards().await?;
    let by_name: HashMap<String, String> =
        existing.into_iter().map(|s| (s.name, s.id)).collect();
    for wb in &dump.whiteboards {
        let id = if let Some(id) = by_name.get(&wb.name) {
            id.clone()
        } else {
            graph.backend.create_whiteboard(&wb.name).await?.id
        };
        graph.backend.save_whiteboard(&id, wb.data.clone()).await?;
    }

    graph.rebuild_search_index().await?;
    Ok(ImportReport {
        pages: page_count,
        blocks: block_count,
    })
}

/// Export the whole graph to an OPML outline file. Each `<outline>` carries
/// a `text` attribute with the block body; pages become top-level outlines.
#[tauri::command]
pub async fn export_opml(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<ExportReport> {
    let graph = state.current()?;
    let pages = graph.backend.list_pages().await?;
    let blocks = graph.backend.all_blocks().await?;
    let mut by_page: HashMap<PageId, Vec<Block>> = HashMap::new();
    for b in blocks.iter().cloned() {
        by_page.entry(b.page_id.clone()).or_default().push(b);
    }

    let mut out = String::new();
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    out.push_str("<opml version=\"2.0\">\n");
    out.push_str("  <head><title>logseq-rs export</title></head>\n");
    out.push_str("  <body>\n");

    let mut block_count = 0usize;
    for page in &pages {
        let mut page_blocks = by_page.remove(&page.id).unwrap_or_default();
        page_blocks.sort_by_key(|b| (b.parent_id.clone(), b.order));
        block_count += page_blocks.len();

        // Build a parent -> children index.
        let mut children: HashMap<Option<String>, Vec<Block>> = HashMap::new();
        for b in page_blocks {
            children.entry(b.parent_id.clone()).or_default().push(b);
        }

        out.push_str(&format!(
            "    <outline text=\"{}\">\n",
            xml_escape(&page.name)
        ));
        write_opml_blocks(&mut out, &children, None, 3);
        out.push_str("    </outline>\n");
    }

    out.push_str("  </body>\n");
    out.push_str("</opml>\n");

    let dest = PathBuf::from(&path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&dest, out.as_bytes())?;
    Ok(ExportReport {
        path: dest.to_string_lossy().into_owned(),
        pages: pages.len(),
        blocks: block_count,
        whiteboards: 0,
    })
}

fn write_opml_blocks(
    out: &mut String,
    children: &HashMap<Option<String>, Vec<Block>>,
    parent: Option<String>,
    indent: usize,
) {
    let Some(kids) = children.get(&parent) else {
        return;
    };
    let pad = "  ".repeat(indent);
    for b in kids {
        let grand = children.get(&Some(b.id.clone())).map(|v| !v.is_empty()).unwrap_or(false);
        let body = xml_escape(first_line(&b.content));
        if grand {
            out.push_str(&format!("{pad}<outline text=\"{body}\">\n"));
            write_opml_blocks(out, children, Some(b.id.clone()), indent + 1);
            out.push_str(&format!("{pad}</outline>\n"));
        } else {
            out.push_str(&format!("{pad}<outline text=\"{body}\"/>\n"));
        }
    }
}

fn first_line(s: &str) -> &str {
    s.lines().next().unwrap_or("")
}

fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

/// Import an OPML outline as a single page. The file name (without the
/// extension) is used as the page name unless the OPML `<head><title>` is
/// set, in which case that takes precedence.
#[tauri::command]
pub async fn import_opml(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<ImportReport> {
    let graph = state.current()?;
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(AppError::NotFound(path));
    }
    let body = std::fs::read_to_string(&src)?;
    let tree = parse_opml(&body)?;

    let mut page_count = 0usize;
    let mut block_count = 0usize;

    for top in &tree {
        let page_name = top.text.trim();
        if page_name.is_empty() {
            continue;
        }
        let page = graph.backend.create_page(page_name).await?;
        for child in &top.children {
            insert_opml_node(&graph.backend, &page.id, None, child, &mut block_count).await?;
        }
        page_count += 1;
    }

    graph.rebuild_search_index().await?;
    Ok(ImportReport {
        pages: page_count,
        blocks: block_count,
    })
}

/// Recursive helper for `import_opml`.
fn insert_opml_node<'a>(
    backend: &'a crate::storage::DynBackend,
    page: &'a PageId,
    parent: Option<String>,
    node: &'a OpmlNode,
    block_count: &'a mut usize,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = AppResult<()>> + Send + 'a>> {
    Box::pin(async move {
        let text = node.text.trim();
        if text.is_empty() && node.children.is_empty() {
            return Ok(());
        }
        let inserted = backend
            .insert_block(page, parent.clone(), None, text)
            .await?;
        *block_count += 1;
        for child in &node.children {
            insert_opml_node(backend, page, Some(inserted.id.clone()), child, block_count).await?;
        }
        Ok(())
    })
}

#[derive(Debug, Default)]
struct OpmlNode {
    text: String,
    children: Vec<OpmlNode>,
}

/// Minimal OPML 2.0 parser — extracts `<outline text="…">` hierarchy from
/// `<body>…</body>`. Ignores attributes other than `text`.
fn parse_opml(src: &str) -> AppResult<Vec<OpmlNode>> {
    let body_start = src.find("<body>").ok_or_else(|| {
        AppError::Invalid("OPML: missing <body> element".into())
    })?;
    let body_end = src
        .find("</body>")
        .ok_or_else(|| AppError::Invalid("OPML: missing </body>".into()))?;
    let body = &src[body_start + "<body>".len()..body_end];

    let mut stack: Vec<Vec<OpmlNode>> = vec![Vec::new()];
    let bytes = body.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // Skip whitespace
        if bytes[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if bytes[i] != b'<' {
            i += 1;
            continue;
        }
        // Find tag end
        let end = match body[i..].find('>') {
            Some(p) => i + p,
            None => break,
        };
        let tag = &body[i + 1..end];
        i = end + 1;
        if tag.starts_with('/') {
            let inner = tag.trim_start_matches('/').trim();
            if inner.starts_with("outline") {
                let finished = stack.pop().unwrap_or_default();
                let parent = stack.last_mut();
                if let Some(parent) = parent {
                    if let Some(last) = parent.last_mut() {
                        last.children = finished;
                    }
                }
            }
            continue;
        }
        if tag.starts_with("!--") || tag.starts_with('?') {
            continue;
        }
        if !tag.starts_with("outline") {
            continue;
        }
        let self_close = tag.trim_end().ends_with('/');
        let text = extract_attr(tag, "text")
            .or_else(|| extract_attr(tag, "title"))
            .unwrap_or_default();
        let decoded = xml_unescape(&text);
        let node = OpmlNode {
            text: decoded,
            children: Vec::new(),
        };
        // Push as a child of current level
        if let Some(level) = stack.last_mut() {
            level.push(node);
        }
        if !self_close {
            stack.push(Vec::new());
        }
    }

    Ok(stack.pop().unwrap_or_default())
}

fn extract_attr(tag: &str, name: &str) -> Option<String> {
    let needle = format!(" {name}=\"");
    let start = tag.find(&needle)? + needle.len();
    let rest = &tag[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn xml_unescape(s: &str) -> String {
    s.replace("&apos;", "'")
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// Export a single page as a standalone Markdown file.
#[tauri::command]
pub async fn export_page_markdown(
    page_id: PageId,
    path: String,
    state: State<'_, AppState>,
) -> AppResult<ExportReport> {
    let graph = state.current()?;
    let page = graph
        .backend
        .get_page(&page_id)
        .await?
        .ok_or_else(|| AppError::NotFound(page_id.clone()))?;
    let mut blocks: Vec<Block> = graph
        .backend
        .all_blocks()
        .await?
        .into_iter()
        .filter(|b| b.page_id == page.id)
        .collect();
    blocks.sort_by_key(|b| (b.parent_id.clone(), b.order));
    let md = parser::render_page_markdown(&blocks);
    let dest = PathBuf::from(&path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&dest, md.as_bytes())?;
    Ok(ExportReport {
        path: dest.to_string_lossy().into_owned(),
        pages: 1,
        blocks: blocks.len(),
        whiteboards: 0,
    })
}
