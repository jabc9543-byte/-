//! Full-text + lightweight semantic search (modules 7 + 26).
//!
//! Two indexes live side-by-side:
//!
//! 1. **Tantivy BM25** (`tantivy::Index`) — fast lexical search over block
//!    content, with page-name boost and snippet highlighting. A permissive
//!    n-gram tokenizer handles both ASCII and CJK text without an external
//!    dictionary.
//! 2. **TF-IDF cosine** (`SemanticStore`) — an in-memory vector model built
//!    from the same tokens. Used by [`SearchIndex::semantic_search`] for
//!    query-by-example ranking and [`SearchIndex::similar`] for "blocks like
//!    this one".
//!
//! Both indexes are rebuilt together by [`SearchIndex::rebuild`]. There is
//! no persistence — the indexes are cheap to rebuild on graph open and are
//! kept in sync incrementally by [`SearchIndex::upsert_block`] and
//! [`SearchIndex::remove_block`] for single-block edits.
//!
//! These indexes are purely in-memory (tantivy uses a `RAMDirectory`), which
//! keeps `<graph>/` clean and avoids schema-version migrations. A graph with
//! 100 k blocks fits comfortably in <100 MiB.

use std::collections::HashMap;
use std::sync::RwLock;

use tantivy::collector::TopDocs;
use tantivy::query::{BooleanQuery, Occur, Query, QueryParser};
use tantivy::schema::{Field, IndexRecordOption, Schema, Value, STORED, STRING, TEXT};
use tantivy::tokenizer::{
    LowerCaser, NgramTokenizer, RemoveLongFilter, TextAnalyzer, TokenizerManager,
};
use tantivy::{Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term};

use crate::error::{AppError, AppResult};
use crate::model::{Block, SearchHit};

const ANALYZER_NAME: &str = "logseq_ngram";

pub struct SearchIndex {
    schema: TantivyFields,
    index: Index,
    reader: IndexReader,
    writer: RwLock<IndexWriter>,
    semantic: RwLock<SemanticStore>,
    pages: RwLock<HashMap<String, String>>, // block_id -> page name (for snippets)
}

struct TantivyFields {
    block_id: Field,
    page: Field,
    content: Field,
}

impl SearchIndex {
    pub fn new() -> AppResult<std::sync::Arc<Self>> {
        let mut builder = Schema::builder();
        let block_id = builder.add_text_field("block_id", STRING | STORED);
        let page = builder.add_text_field("page", TEXT | STORED);
        let content_opts = tantivy::schema::TextOptions::default()
            .set_stored()
            .set_indexing_options(
                tantivy::schema::TextFieldIndexing::default()
                    .set_tokenizer(ANALYZER_NAME)
                    .set_index_option(IndexRecordOption::WithFreqsAndPositions),
            );
        let content = builder.add_text_field("content", content_opts);
        let schema = builder.build();

        let index = Index::create_in_ram(schema);
        register_analyzer(index.tokenizers());

        let writer = index
            .writer(50_000_000)
            .map_err(|e| AppError::Other(format!("tantivy writer: {e}")))?;
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()
            .map_err(|e| AppError::Other(format!("tantivy reader: {e}")))?;

        Ok(std::sync::Arc::new(Self {
            schema: TantivyFields {
                block_id,
                page,
                content,
            },
            index,
            reader,
            writer: RwLock::new(writer),
            semantic: RwLock::new(SemanticStore::default()),
            pages: RwLock::new(HashMap::new()),
        }))
    }

    /// Drop everything and reindex from scratch.
    pub fn rebuild<F: Fn(&str) -> String>(
        &self,
        blocks: &[Block],
        page_name: F,
    ) -> AppResult<()> {
        let mut w = self
            .writer
            .write()
            .map_err(|_| AppError::Other("search writer poisoned".into()))?;
        w.delete_all_documents()
            .map_err(|e| AppError::Other(format!("tantivy clear: {e}")))?;

        let mut pages = HashMap::with_capacity(blocks.len());
        let mut sem = SemanticStore::default();

        for b in blocks {
            let name = page_name(&b.page_id);
            pages.insert(b.id.clone(), name.clone());
            let mut doc = TantivyDocument::default();
            doc.add_text(self.schema.block_id, &b.id);
            doc.add_text(self.schema.page, &name);
            doc.add_text(self.schema.content, &b.content);
            w.add_document(doc)
                .map_err(|e| AppError::Other(format!("tantivy add: {e}")))?;
            sem.add(&b.id, &b.content, &name);
        }
        sem.finalize();
        w.commit()
            .map_err(|e| AppError::Other(format!("tantivy commit: {e}")))?;
        self.reader
            .reload()
            .map_err(|e| AppError::Other(format!("tantivy reload: {e}")))?;

        *self
            .pages
            .write()
            .map_err(|_| AppError::Other("pages lock poisoned".into()))? = pages;
        *self
            .semantic
            .write()
            .map_err(|_| AppError::Other("semantic lock poisoned".into()))? = sem;
        Ok(())
    }

    /// Replace the entry for a single block.
    pub fn upsert_block(&self, block: &Block, page: &str) -> AppResult<()> {
        {
            let mut w = self
                .writer
                .write()
                .map_err(|_| AppError::Other("search writer poisoned".into()))?;
            let term = Term::from_field_text(self.schema.block_id, &block.id);
            w.delete_term(term);
            let mut doc = TantivyDocument::default();
            doc.add_text(self.schema.block_id, &block.id);
            doc.add_text(self.schema.page, page);
            doc.add_text(self.schema.content, &block.content);
            w.add_document(doc)
                .map_err(|e| AppError::Other(format!("tantivy add: {e}")))?;
            w.commit()
                .map_err(|e| AppError::Other(format!("tantivy commit: {e}")))?;
        }
        self.reader
            .reload()
            .map_err(|e| AppError::Other(format!("tantivy reload: {e}")))?;
        self.pages
            .write()
            .map_err(|_| AppError::Other("pages lock poisoned".into()))?
            .insert(block.id.clone(), page.to_string());
        let mut sem = self
            .semantic
            .write()
            .map_err(|_| AppError::Other("semantic lock poisoned".into()))?;
        sem.remove(&block.id);
        sem.add(&block.id, &block.content, page);
        sem.finalize();
        Ok(())
    }

    pub fn remove_block(&self, id: &str) -> AppResult<()> {
        {
            let mut w = self
                .writer
                .write()
                .map_err(|_| AppError::Other("search writer poisoned".into()))?;
            let term = Term::from_field_text(self.schema.block_id, id);
            w.delete_term(term);
            w.commit()
                .map_err(|e| AppError::Other(format!("tantivy commit: {e}")))?;
        }
        self.reader
            .reload()
            .map_err(|e| AppError::Other(format!("tantivy reload: {e}")))?;
        self.pages
            .write()
            .map_err(|_| AppError::Other("pages lock poisoned".into()))?
            .remove(id);
        let mut sem = self
            .semantic
            .write()
            .map_err(|_| AppError::Other("semantic lock poisoned".into()))?;
        sem.remove(id);
        sem.finalize();
        Ok(())
    }

    /// Standard BM25 keyword search.
    pub fn search(&self, query: &str, limit: usize) -> AppResult<Vec<SearchHit>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(vec![]);
        }
        let searcher = self.reader.searcher();
        if searcher.num_docs() == 0 {
            return Ok(vec![]);
        }
        let parser = QueryParser::for_index(
            &self.index,
            vec![self.schema.content, self.schema.page],
        );
        // Fall back to permissive match if the query has syntactic oddities
        // (parentheses, stray operators); we don't want users to see parse
        // errors for natural-language queries.
        let parsed: Box<dyn Query> = match parser.parse_query(trimmed) {
            Ok(q) => q,
            Err(_) => {
                let terms = tokenize(trimmed);
                if terms.is_empty() {
                    return Ok(vec![]);
                }
                let mut sub: Vec<(Occur, Box<dyn Query>)> = Vec::with_capacity(terms.len());
                for t in terms {
                    let term = Term::from_field_text(self.schema.content, &t);
                    sub.push((
                        Occur::Should,
                        Box::new(tantivy::query::TermQuery::new(
                            term,
                            IndexRecordOption::WithFreqs,
                        )),
                    ));
                }
                Box::new(BooleanQuery::new(sub))
            }
        };
        let top = searcher
            .search(&parsed, &TopDocs::with_limit(limit.max(1)))
            .map_err(|e| AppError::Other(format!("tantivy search: {e}")))?;
        let mut hits = Vec::with_capacity(top.len());
        for (_score, addr) in top {
            let doc: TantivyDocument = searcher
                .doc(addr)
                .map_err(|e| AppError::Other(format!("tantivy doc: {e}")))?;
            if let Some(hit) = self.hit_from_doc(&doc, trimmed) {
                hits.push(hit);
            }
        }
        Ok(hits)
    }

    /// Rank blocks by cosine similarity against a free-text query. This is
    /// looser than [`search`] — unrelated terms score 0 but any matching
    /// term contributes smoothly, so mis-spelled or partial queries still
    /// surface relevant blocks.
    pub fn semantic_search(&self, query: &str, limit: usize) -> AppResult<Vec<SearchHit>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(vec![]);
        }
        let sem = self
            .semantic
            .read()
            .map_err(|_| AppError::Other("semantic lock poisoned".into()))?;
        let pages = self
            .pages
            .read()
            .map_err(|_| AppError::Other("pages lock poisoned".into()))?;
        let ranked = sem.rank_query(trimmed, limit);
        Ok(ranked
            .into_iter()
            .filter_map(|(id, _score, snippet)| {
                Some(SearchHit {
                    page: pages.get(&id).cloned().unwrap_or_default(),
                    block_id: id,
                    snippet,
                })
            })
            .collect())
    }

    /// Find blocks most similar to the given block.
    pub fn similar(&self, block_id: &str, limit: usize) -> AppResult<Vec<SearchHit>> {
        let sem = self
            .semantic
            .read()
            .map_err(|_| AppError::Other("semantic lock poisoned".into()))?;
        let pages = self
            .pages
            .read()
            .map_err(|_| AppError::Other("pages lock poisoned".into()))?;
        let ranked = sem.rank_similar(block_id, limit);
        Ok(ranked
            .into_iter()
            .filter_map(|(id, _score, snippet)| {
                Some(SearchHit {
                    page: pages.get(&id).cloned().unwrap_or_default(),
                    block_id: id,
                    snippet,
                })
            })
            .collect())
    }

    fn hit_from_doc(&self, doc: &TantivyDocument, query: &str) -> Option<SearchHit> {
        let block_id = field_text(doc, self.schema.block_id)?;
        let page = field_text(doc, self.schema.page).unwrap_or_default();
        let content = field_text(doc, self.schema.content).unwrap_or_default();
        Some(SearchHit {
            block_id,
            page,
            snippet: make_snippet(&content, query, 140),
        })
    }
}

fn field_text(doc: &TantivyDocument, field: Field) -> Option<String> {
    doc.get_first(field)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

// ---- tokenizer -----------------------------------------------------------

fn register_analyzer(mgr: &TokenizerManager) {
    // Ngram(1,2) is permissive but works uniformly for CJK (matches single
    // characters + bigrams) and ASCII (matches short substrings). BM25 keeps
    // noise suppressed; long query words are still matched because
    // `QueryParser` tokenizes the query the same way.
    let ngram = NgramTokenizer::new(1, 2, false).expect("valid ngram bounds");
    let analyzer = TextAnalyzer::builder(ngram)
        .filter(RemoveLongFilter::limit(64))
        .filter(LowerCaser)
        .build();
    mgr.register(ANALYZER_NAME, analyzer);
}

fn tokenize(text: &str) -> Vec<String> {
    // Mirror the n-gram analyzer for ad-hoc tokenization (semantic index,
    // fallback term queries). 1- and 2-char shingles, lowercased.
    let lower: String = text.to_lowercase();
    let chars: Vec<char> = lower
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    let mut out = Vec::with_capacity(chars.len() * 2);
    for i in 0..chars.len() {
        out.push(chars[i].to_string());
        if i + 1 < chars.len() {
            let mut s = String::new();
            s.push(chars[i]);
            s.push(chars[i + 1]);
            out.push(s);
        }
    }
    out
}

fn make_snippet(content: &str, query: &str, width: usize) -> String {
    if content.is_empty() {
        return String::new();
    }
    let lc = content.to_lowercase();
    let q = query.trim().to_lowercase();
    let start_char = q
        .split_whitespace()
        .filter(|t| !t.is_empty())
        .find_map(|t| lc.find(t))
        .unwrap_or(0);
    // Convert byte offset to char offset so Unicode boundaries stay valid.
    let char_start = content[..start_char.min(content.len())].chars().count();
    let total = content.chars().count();
    let half = width / 2;
    let begin = char_start.saturating_sub(half);
    let end = (begin + width).min(total);
    let slice: String = content
        .chars()
        .skip(begin)
        .take(end - begin)
        .collect();
    let mut out = String::new();
    if begin > 0 {
        out.push('…');
    }
    out.push_str(slice.trim());
    if end < total {
        out.push('…');
    }
    out
}

// ---- semantic (TF-IDF) ---------------------------------------------------

#[derive(Default)]
struct SemanticStore {
    /// Per-block term frequencies. We keep raw tf; norms are computed in
    /// `finalize` once IDFs are known.
    docs: HashMap<String, DocVec>,
    /// Document frequency per term (how many blocks contain the term).
    df: HashMap<String, u32>,
    /// Total number of docs at last finalize.
    n_docs: u32,
}

struct DocVec {
    tf: HashMap<String, u32>,
    raw: String,
    norm: f32,
}

impl SemanticStore {
    fn add(&mut self, id: &str, content: &str, page: &str) {
        let _ = page;
        let tokens = tokenize(content);
        if tokens.is_empty() {
            self.docs.insert(
                id.to_string(),
                DocVec {
                    tf: HashMap::new(),
                    raw: content.to_string(),
                    norm: 0.0,
                },
            );
            return;
        }
        let mut tf: HashMap<String, u32> = HashMap::new();
        for t in tokens {
            *tf.entry(t).or_insert(0) += 1;
        }
        // Only count each term once per doc toward DF.
        for term in tf.keys() {
            *self.df.entry(term.clone()).or_insert(0) += 1;
        }
        self.docs.insert(
            id.to_string(),
            DocVec {
                tf,
                raw: content.to_string(),
                norm: 0.0,
            },
        );
    }

    fn remove(&mut self, id: &str) {
        if let Some(doc) = self.docs.remove(id) {
            for term in doc.tf.keys() {
                if let Some(c) = self.df.get_mut(term) {
                    *c = c.saturating_sub(1);
                    if *c == 0 {
                        self.df.remove(term);
                    }
                }
            }
        }
    }

    fn finalize(&mut self) {
        self.n_docs = self.docs.len() as u32;
        let n = self.n_docs.max(1) as f32;
        for doc in self.docs.values_mut() {
            let mut sum_sq = 0.0_f32;
            for (term, &tf) in &doc.tf {
                let df = *self.df.get(term).unwrap_or(&1) as f32;
                let idf = (1.0_f32 + (n / df.max(1.0))).ln();
                let w = (tf as f32) * idf;
                sum_sq += w * w;
            }
            doc.norm = sum_sq.sqrt();
        }
    }

    fn weight(&self, term: &str, tf: u32) -> f32 {
        let df = *self.df.get(term).unwrap_or(&0);
        if df == 0 {
            return 0.0;
        }
        let n = self.n_docs.max(1) as f32;
        let idf = (1.0_f32 + (n / df as f32)).ln();
        (tf as f32) * idf
    }

    fn rank_query(&self, query: &str, limit: usize) -> Vec<(String, f32, String)> {
        let tokens = tokenize(query);
        if tokens.is_empty() {
            return vec![];
        }
        let mut qtf: HashMap<String, u32> = HashMap::new();
        for t in &tokens {
            *qtf.entry(t.clone()).or_insert(0) += 1;
        }
        let mut q_norm_sq = 0.0_f32;
        for (term, &tf) in &qtf {
            let w = self.weight(term, tf);
            q_norm_sq += w * w;
        }
        let q_norm = q_norm_sq.sqrt();
        if q_norm == 0.0 {
            return vec![];
        }
        let mut scores: HashMap<&str, f32> = HashMap::new();
        for (term, &qtf_val) in &qtf {
            let qw = self.weight(term, qtf_val);
            if qw == 0.0 {
                continue;
            }
            for (id, doc) in &self.docs {
                if let Some(&tf) = doc.tf.get(term) {
                    let dw = self.weight(term, tf);
                    *scores.entry(id.as_str()).or_insert(0.0) += qw * dw;
                }
            }
        }
        let mut ranked: Vec<(String, f32, String)> = scores
            .into_iter()
            .filter_map(|(id, dot)| {
                let doc = self.docs.get(id)?;
                if doc.norm == 0.0 {
                    return None;
                }
                let score = dot / (doc.norm * q_norm);
                Some((
                    id.to_string(),
                    score,
                    make_snippet(&doc.raw, query, 140),
                ))
            })
            .collect();
        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        ranked.truncate(limit.max(1));
        ranked
    }

    fn rank_similar(&self, seed_id: &str, limit: usize) -> Vec<(String, f32, String)> {
        let Some(seed) = self.docs.get(seed_id) else {
            return vec![];
        };
        if seed.norm == 0.0 {
            return vec![];
        }
        let mut ranked: Vec<(String, f32, String)> = self
            .docs
            .iter()
            .filter_map(|(id, doc)| {
                if id == seed_id || doc.norm == 0.0 {
                    return None;
                }
                let mut dot = 0.0_f32;
                for (term, &tf) in &seed.tf {
                    if let Some(&dtf) = doc.tf.get(term) {
                        let sw = self.weight(term, tf);
                        let dw = self.weight(term, dtf);
                        dot += sw * dw;
                    }
                }
                if dot == 0.0 {
                    return None;
                }
                let score = dot / (seed.norm * doc.norm);
                Some((id.clone(), score, make_snippet(&doc.raw, "", 140)))
            })
            .collect();
        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        ranked.truncate(limit.max(1));
        ranked
    }
}
