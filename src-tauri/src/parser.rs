//! Markdown / Logseq-flavor parser utilities.
//!
//! Responsibilities:
//! * Extract `[[page]]`, `#tag`, `((block-ref))` references from a block's content.
//! * Convert a page's markdown file into an ordered tree of blocks (and back).
//!
//! This parser is intentionally conservative: it aims to be compatible with the
//! basic Logseq outline grammar (`- ` bullets with 2/4-space indentation) while
//! passing through all inline markdown unchanged.

use once_cell::sync::Lazy;
use regex::Regex;

use crate::model::{Block, BlockId, PageId, TaskMarker};

static RE_PAGE_REF: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[\[([^\[\]]+?)\]\]").unwrap());
static RE_BLOCK_REF: Lazy<Regex> = Lazy::new(|| Regex::new(r"\(\(([A-Za-z0-9_\-]{6,})\)\)").unwrap());
static RE_TAG: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?:^|\s)#([\p{L}\p{N}_\-/]+)").unwrap());
static RE_TASK: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(TODO|DOING|DONE|LATER|NOW|WAITING|CANCELLED)(\s|$)").unwrap()
});
static RE_SCHEDULED: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)SCHEDULED:\s*<(\d{4}-\d{2}-\d{2})").unwrap());
static RE_DEADLINE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)DEADLINE:\s*<(\d{4}-\d{2}-\d{2})").unwrap());
static RE_BLOCK_ID_COMMENT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^<!--\s*logseq-rs:block-id:([A-Za-z0-9_\-]{6,})\s*-->$").unwrap()
});

#[derive(Debug, Default, Clone)]
pub struct References {
    pub pages: Vec<String>,
    pub blocks: Vec<BlockId>,
    pub tags: Vec<String>,
}

pub fn extract_refs(content: &str) -> References {
    let mut r = References::default();
    for cap in RE_PAGE_REF.captures_iter(content) {
        r.pages.push(cap[1].trim().to_string());
    }
    for cap in RE_BLOCK_REF.captures_iter(content) {
        r.blocks.push(cap[1].to_string());
    }
    for cap in RE_TAG.captures_iter(content) {
        r.tags.push(cap[1].to_string());
    }
    r.pages.sort();
    r.pages.dedup();
    r.blocks.sort();
    r.blocks.dedup();
    r.tags.sort();
    r.tags.dedup();
    r
}

/// Apply reference extraction into a block (mutating its `refs_*` / `tags` fields).
pub fn annotate_block(block: &mut Block) {
    let r = extract_refs(&block.content);
    block.refs_pages = r.pages;
    block.refs_blocks = r.blocks;
    block.tags = r.tags;
    block.task_marker = extract_task_marker(&block.content);
    let (sched, dead) = extract_dates(&block.content);
    block.scheduled = sched;
    block.deadline = dead;
}

pub fn extract_task_marker(content: &str) -> Option<TaskMarker> {
    let first = content.lines().next().unwrap_or("").trim_start();
    let cap = RE_TASK.captures(first)?;
    TaskMarker::from_str(&cap[1])
}

pub fn extract_dates(content: &str) -> (Option<String>, Option<String>) {
    let sched = RE_SCHEDULED
        .captures(content)
        .map(|c| c[1].to_string());
    let dead = RE_DEADLINE.captures(content).map(|c| c[1].to_string());
    (sched, dead)
}

fn extract_block_id_comment(line: &str) -> Option<BlockId> {
    RE_BLOCK_ID_COMMENT
        .captures(line.trim())
        .map(|cap| cap[1].to_string())
}

/// Replace the task marker at the start of the block's first line.
/// If the block has no marker, prepend `new`. If `new` is `None`, strip it.
pub fn set_task_marker(content: &str, new: Option<TaskMarker>) -> String {
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    if lines.is_empty() {
        lines.push(String::new());
    }
    let first = &lines[0];
    let (indent, rest) = split_indent_str(first);
    let stripped = if let Some(cap) = RE_TASK.captures(rest) {
        rest[cap.get(0).unwrap().end()..].trim_start().to_string()
    } else {
        rest.to_string()
    };
    lines[0] = match new {
        Some(m) => format!("{indent}{} {stripped}", m.as_str()),
        None => format!("{indent}{stripped}"),
    };
    lines.join("\n")
}

fn split_indent_str(s: &str) -> (&str, &str) {
    let idx = s.find(|c: char| !c.is_whitespace()).unwrap_or(s.len());
    s.split_at(idx)
}

/// Parse a markdown file's body into an ordered flat list of blocks that share
/// a `page_id`. Indentation of 2 spaces (or tab) per level is recognized.
///
/// Non-bullet lines are merged into the preceding block as continuation text.
pub fn parse_page_markdown(page_id: &PageId, body: &str) -> Vec<Block> {
    let mut blocks: Vec<Block> = Vec::new();
    // Stack of (indent_level, block_index) pointing at the most recent ancestor chain.
    let mut stack: Vec<(usize, usize)> = Vec::new();
    // Monotonically increasing order counter per indentation level; never rewinds
    // so that sibling sets at the same level keep distinct, ascending orders.
    let mut next_order: Vec<i64> = Vec::new();

    for raw_line in body.lines() {
        let (indent, rest) = split_indent(raw_line);
        let bullet = rest.starts_with("- ") || rest == "-";

        if !bullet {
            if let Some(last) = blocks.last_mut() {
                if let Some(block_id) = extract_block_id_comment(rest) {
                    last.id = block_id;
                    continue;
                }
                if !last.content.is_empty() {
                    last.content.push('\n');
                }
                last.content.push_str(raw_line);
            }
            continue;
        }

        let content = rest.trim_start_matches('-').trim_start().to_string();
        let level = indent;

        // Pop ancestor stack to a strict parent level.
        while let Some(&(l, _)) = stack.last() {
            if l >= level {
                stack.pop();
            } else {
                break;
            }
        }

        if next_order.len() <= level {
            next_order.resize(level + 1, 0);
        }
        let ord = next_order[level];
        next_order[level] = ord + 1;

        let parent_id = stack.last().map(|&(_, idx)| blocks[idx].id.clone());
        let mut block = Block::new(page_id.clone(), parent_id, ord, content);
        annotate_block(&mut block);
        blocks.push(block);
        let idx = blocks.len() - 1;
        stack.push((level, idx));
    }

    // Link children refs from parents.
    let mut children_map: std::collections::HashMap<BlockId, Vec<BlockId>> = Default::default();
    for b in &blocks {
        if let Some(p) = &b.parent_id {
            children_map.entry(p.clone()).or_default().push(b.id.clone());
        }
    }
    for b in blocks.iter_mut() {
        if let Some(c) = children_map.remove(&b.id) {
            b.children = c;
        }
    }

    blocks
}

/// Serialize a page's block tree back to markdown with `-` bullets.
pub fn render_page_markdown(blocks: &[Block]) -> String {
    let mut out = String::new();
    // Build an id -> block map + roots by order.
    let by_id: std::collections::HashMap<_, _> =
        blocks.iter().map(|b| (b.id.clone(), b)).collect();
    let mut roots: Vec<&Block> = blocks.iter().filter(|b| b.parent_id.is_none()).collect();
    roots.sort_by_key(|b| b.order);

    fn write(
        out: &mut String,
        block: &Block,
        depth: usize,
        by_id: &std::collections::HashMap<BlockId, &Block>,
    ) {
        let indent = "  ".repeat(depth);
        let first_line_done;
        let mut lines = block.content.lines();
        if let Some(first) = lines.next() {
            out.push_str(&format!("{indent}- {first}\n"));
            first_line_done = true;
        } else {
            out.push_str(&format!("{indent}-\n"));
            first_line_done = false;
        }
        for line in lines {
            out.push_str(&format!("{indent}  {line}\n"));
        }
        out.push_str(&format!("{indent}  <!-- logseq-rs:block-id:{} -->\n", block.id));
        let _ = first_line_done;

        let mut kids: Vec<&Block> = block
            .children
            .iter()
            .filter_map(|id| by_id.get(id).copied())
            .collect();
        kids.sort_by_key(|b| b.order);
        for k in kids {
            write(out, k, depth + 1, by_id);
        }
    }

    for r in roots {
        write(&mut out, r, 0, &by_id);
    }
    out
}

fn split_indent(line: &str) -> (usize, &str) {
    let mut spaces = 0;
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b' ' => {
                spaces += 1;
                i += 1;
            }
            b'\t' => {
                spaces += 2;
                i += 1;
            }
            _ => break,
        }
    }
    (spaces / 2, &line[i..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_page_and_tag_refs() {
        let refs = extract_refs("hello [[World]] and [[Foo Bar]] #todo ((abc123))");
        assert_eq!(refs.pages, vec!["Foo Bar".to_string(), "World".to_string()]);
        assert_eq!(refs.tags, vec!["todo".to_string()]);
        assert_eq!(refs.blocks, vec!["abc123".to_string()]);
    }

    #[test]
    fn parses_outline() {
        let md = "- root\n  - child\n    - grand\n- next";
        let blocks = parse_page_markdown(&"p".to_string(), md);
        assert_eq!(blocks.len(), 4);
        assert_eq!(blocks[0].content, "root");
        assert_eq!(blocks[1].parent_id.as_deref(), Some(blocks[0].id.as_str()));
        assert_eq!(blocks[2].parent_id.as_deref(), Some(blocks[1].id.as_str()));
        assert!(blocks[3].parent_id.is_none());
    }

    #[test]
    fn roundtrip_preserves_block_ids() {
        let md = "- root\n  - child\n- next";
        let first = parse_page_markdown(&"p".to_string(), md);
        let rendered = render_page_markdown(&first);
        let second = parse_page_markdown(&"p".to_string(), &rendered);
        assert_eq!(first.len(), second.len());
        assert_eq!(first[0].id, second[0].id);
        assert_eq!(first[1].id, second[1].id);
        assert_eq!(first[2].id, second[2].id);
        assert_eq!(second[1].parent_id.as_deref(), Some(second[0].id.as_str()));
    }

    #[test]
    fn parses_embedded_block_id_comments() {
        let md = "- root\n  <!-- logseq-rs:block-id:abc12345 -->\n  - child\n    <!-- logseq-rs:block-id:def67890 -->";
        let blocks = parse_page_markdown(&"p".to_string(), md);
        assert_eq!(blocks[0].id, "abc12345");
        assert_eq!(blocks[1].id, "def67890");
        assert_eq!(blocks[1].parent_id.as_deref(), Some("abc12345"));
    }
}
