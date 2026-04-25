//! Logseq-flavored simple-query engine.
//!
//! Grammar (s-expression form, or a bare atom):
//! ```text
//! query  := atom | '(' op arg* ')'
//! atom   := page-ref | tag | block-ref | string
//! op     := and | or | not
//!         | page-ref | page  | tag | task | contains
//! ```
//!
//! Examples:
//! ```text
//! [[Project]]
//! #todo
//! (and [[Project]] #todo)
//! (or #urgent #important)
//! (and [[Project]] (not #done))
//! (contains "review")
//! (task TODO DOING)
//! ```
//!
//! The engine evaluates expressions over the fully-populated block set
//! returned by [`Backend::all_blocks`](crate::storage::Backend::all_blocks).

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::model::Block;

pub mod parse;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Expr {
    /// Match any block whose `refs_pages` contains `name` (case-insensitive).
    PageRef { name: String },
    /// Match any block whose `tags` contains `tag` (case-insensitive).
    Tag { tag: String },
    /// Match the block whose id equals `id`, or blocks referencing it.
    BlockRef { id: String },
    /// Match blocks whose content contains one of `words` (case-insensitive).
    Contains { words: Vec<String> },
    /// Match blocks whose leading marker is one of `markers`
    /// (e.g. `TODO`, `DOING`, `DONE`, `LATER`, `NOW`, `WAITING`, `CANCELLED`).
    Task { markers: Vec<String> },
    And { children: Vec<Expr> },
    Or { children: Vec<Expr> },
    Not { child: Box<Expr> },
}

/// Evaluate `expr` against the provided block set and return matching blocks.
pub fn evaluate(expr: &Expr, blocks: &[Block]) -> Vec<Block> {
    blocks
        .iter()
        .filter(|b| matches(expr, b))
        .cloned()
        .collect()
}

fn matches(expr: &Expr, b: &Block) -> bool {
    match expr {
        Expr::PageRef { name } => b
            .refs_pages
            .iter()
            .any(|p| p.eq_ignore_ascii_case(name)),
        Expr::Tag { tag } => b.tags.iter().any(|t| t.eq_ignore_ascii_case(tag)),
        Expr::BlockRef { id } => &b.id == id || b.refs_blocks.iter().any(|x| x == id),
        Expr::Contains { words } => {
            let lc = b.content.to_lowercase();
            words.iter().any(|w| lc.contains(&w.to_lowercase()))
        }
        Expr::Task { markers } => {
            let first = b
                .content
                .split_whitespace()
                .next()
                .unwrap_or("")
                .to_uppercase();
            markers
                .iter()
                .any(|m| first == m.to_uppercase())
        }
        Expr::And { children } => children.iter().all(|x| matches(x, b)),
        Expr::Or { children } => children.iter().any(|x| matches(x, b)),
        Expr::Not { child } => !matches(child, b),
    }
}

/// Parse and evaluate a query string in one step.
pub fn run(query: &str, blocks: &[Block]) -> AppResult<Vec<Block>> {
    let expr = parse::parse(query).map_err(|e| AppError::Invalid(e))?;
    Ok(evaluate(&expr, blocks))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Block;

    fn mk(page: &str, content: &str, refs: &[&str], tags: &[&str]) -> Block {
        let mut b = Block::new(page.into(), None, 0, content.into());
        b.refs_pages = refs.iter().map(|s| s.to_string()).collect();
        b.tags = tags.iter().map(|s| s.to_string()).collect();
        b
    }

    #[test]
    fn page_ref_and_tag() {
        let blocks = vec![
            mk("p", "hello [[World]]", &["World"], &[]),
            mk("p", "TODO x #todo", &[], &["todo"]),
            mk("p", "y [[World]] #todo", &["World"], &["todo"]),
        ];
        let hits = run("(and [[World]] #todo)", &blocks).unwrap();
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn not_and_or() {
        let blocks = vec![
            mk("p", "a", &[], &["todo"]),
            mk("p", "b", &[], &["done"]),
        ];
        assert_eq!(run("(not #done)", &blocks).unwrap().len(), 1);
        assert_eq!(run("(or #todo #done)", &blocks).unwrap().len(), 2);
    }

    #[test]
    fn task_marker() {
        let blocks = vec![
            mk("p", "TODO finish me", &[], &[]),
            mk("p", "DONE ok", &[], &[]),
            mk("p", "just text", &[], &[]),
        ];
        let hits = run("(task TODO DOING)", &blocks).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].content.starts_with("TODO"));
    }
}
