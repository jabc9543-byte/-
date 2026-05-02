//! PDF annotation and Zotero import support.
//!
//! PDFs are copied into `<graph_root>/assets/pdf/<id>.pdf` and their metadata
//! is tracked in `<graph_root>/assets/pdf/index.json`. Annotations for each
//! PDF are persisted alongside as `<id>.annotations.json`.
//!
//! Zotero support parses a BibTeX document and creates one page per entry
//! (named `@<citekey>`), populating page properties with the bibliographic
//! fields. This keeps imports fully offline and dependency-free.

use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

// ---------------- types -----------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfAsset {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub size: u64,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfAnnotation {
    pub id: String,
    pub page: u32,
    /// Highlight rectangles in PDF page coordinates (percent of page size):
    /// `[{x, y, w, h}, ...]`.
    pub rects: Vec<Rect>,
    /// Free-hand pen strokes drawn directly on the page (percent coords).
    #[serde(default)]
    pub strokes: Vec<Stroke>,
    /// Extracted text content of the highlight.
    pub text: String,
    /// Colour name ("yellow", "green", ...).
    pub color: String,
    /// Optional user note attached to the highlight.
    pub note: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrokePoint {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stroke {
    pub color: String,
    pub width: f32,
    pub points: Vec<StrokePoint>,
}

#[derive(Debug, Serialize)]
pub struct ZoteroReport {
    pub pages_created: usize,
    pub entries_seen: usize,
}

// ---------------- helpers ---------------

fn graph_root(state: &AppState) -> AppResult<PathBuf> {
    Ok(PathBuf::from(&state.current()?.meta.root))
}

fn pdf_dir(state: &AppState) -> AppResult<PathBuf> {
    let dir = graph_root(state)?.join("assets").join("pdf");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn index_path(state: &AppState) -> AppResult<PathBuf> {
    Ok(pdf_dir(state)?.join("index.json"))
}

fn read_index(state: &AppState) -> AppResult<Vec<PdfAsset>> {
    let p = index_path(state)?;
    if !p.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&p)?;
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

fn write_index(state: &AppState, items: &[PdfAsset]) -> AppResult<()> {
    let p = index_path(state)?;
    let raw = serde_json::to_string_pretty(items)?;
    fs::write(p, raw)?;
    Ok(())
}

fn annotations_path(state: &AppState, pdf_id: &str) -> AppResult<PathBuf> {
    if !pdf_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err(AppError::Invalid("invalid pdf id".into()));
    }
    Ok(pdf_dir(state)?.join(format!("{pdf_id}.annotations.json")))
}

// ---------------- PDF commands ---------------

#[tauri::command]
pub async fn import_pdf(
    src_path: String,
    state: State<'_, AppState>,
) -> AppResult<PdfAsset> {
    let src = PathBuf::from(&src_path);
    if !src.is_file() {
        return Err(AppError::NotFound(src_path));
    }
    let name = src
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "document".to_string());
    let id = nanoid::nanoid!(12);
    let filename = format!("{id}.pdf");
    let dest = pdf_dir(&state)?.join(&filename);
    fs::copy(&src, &dest)?;
    build_pdf_asset(state.inner(), id, filename, name)
}

#[tauri::command]
pub async fn import_pdf_bytes(
    name: String,
    bytes: Vec<u8>,
    state: State<'_, AppState>,
) -> AppResult<PdfAsset> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Invalid("pdf name cannot be empty".into()));
    }
    if bytes.is_empty() {
        return Err(AppError::Invalid("pdf bytes cannot be empty".into()));
    }
    let id = nanoid::nanoid!(12);
    let filename = format!("{id}.pdf");
    let dest = pdf_dir(&state)?.join(&filename);
    fs::write(&dest, bytes)?;
    build_pdf_asset(state.inner(), id, filename, trimmed.to_string())
}

fn build_pdf_asset(
    state: &AppState,
    id: String,
    filename: String,
    name: String,
) -> AppResult<PdfAsset> {
    let dest = pdf_dir(state)?.join(&filename);
    let size = fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    let asset = PdfAsset {
        id: id.clone(),
        name,
        filename,
        size,
        added_at: Utc::now().to_rfc3339(),
    };
    let mut idx = read_index(state)?;
    idx.push(asset.clone());
    write_index(state, &idx)?;
    Ok(asset)
}

#[tauri::command]
pub async fn list_pdfs(state: State<'_, AppState>) -> AppResult<Vec<PdfAsset>> {
    read_index(&state)
}

#[tauri::command]
pub async fn read_pdf_bytes(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<u8>> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err(AppError::Invalid("invalid pdf id".into()));
    }
    let path = pdf_dir(&state)?.join(format!("{id}.pdf"));
    if !path.is_file() {
        return Err(AppError::NotFound(id));
    }
    Ok(fs::read(path)?)
}

#[tauri::command]
pub async fn delete_pdf(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let mut idx = read_index(&state)?;
    let before = idx.len();
    idx.retain(|a| a.id != id);
    if idx.len() == before {
        return Err(AppError::NotFound(id));
    }
    write_index(&state, &idx)?;
    let pdf = pdf_dir(&state)?.join(format!("{id}.pdf"));
    let _ = fs::remove_file(pdf);
    let _ = fs::remove_file(annotations_path(&state, &id)?);
    Ok(())
}

#[tauri::command]
pub async fn list_pdf_annotations(
    pdf_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<PdfAnnotation>> {
    let p = annotations_path(&state, &pdf_id)?;
    if !p.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(p)?;
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

#[tauri::command]
pub async fn save_pdf_annotations(
    pdf_id: String,
    annotations: Vec<PdfAnnotation>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let p = annotations_path(&state, &pdf_id)?;
    let raw = serde_json::to_string_pretty(&annotations)?;
    fs::write(p, raw)?;
    Ok(())
}

// ---------------- Zotero BibTeX ---------------

#[derive(Debug)]
struct BibEntry {
    entry_type: String,
    citekey: String,
    fields: Vec<(String, String)>,
}

fn parse_bibtex(input: &str) -> Vec<BibEntry> {
    let bytes = input.as_bytes();
    let mut i = 0;
    let mut out = Vec::new();
    while i < bytes.len() {
        // Skip until '@'.
        while i < bytes.len() && bytes[i] != b'@' {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        i += 1; // consume '@'
        // Read entry type.
        let t_start = i;
        while i < bytes.len() && bytes[i] != b'{' && bytes[i] != b'(' && !bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        let entry_type = input[t_start..i].trim().to_lowercase();
        // Skip whitespace then opening brace.
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() || (bytes[i] != b'{' && bytes[i] != b'(') {
            continue;
        }
        i += 1;
        // Skip comment/string/preamble entries.
        if matches!(entry_type.as_str(), "comment" | "string" | "preamble") {
            i = skip_balanced(bytes, i);
            continue;
        }
        // Read citekey up to ','.
        let k_start = i;
        while i < bytes.len() && bytes[i] != b',' && bytes[i] != b'}' && bytes[i] != b')' {
            i += 1;
        }
        let citekey = input[k_start..i].trim().to_string();
        let mut fields: Vec<(String, String)> = Vec::new();
        while i < bytes.len() && bytes[i] != b'}' && bytes[i] != b')' {
            if bytes[i] == b',' || bytes[i].is_ascii_whitespace() {
                i += 1;
                continue;
            }
            // Read field name.
            let n_start = i;
            while i < bytes.len() && bytes[i] != b'=' && bytes[i] != b'}' && bytes[i] != b')' {
                i += 1;
            }
            let name = input[n_start..i].trim().to_lowercase();
            if i >= bytes.len() || bytes[i] != b'=' {
                break;
            }
            i += 1; // consume '='
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            let (value, consumed) = read_bib_value(&bytes[i..]);
            i += consumed;
            if !name.is_empty() {
                fields.push((name, value));
            }
            // Skip trailing comma/whitespace.
            while i < bytes.len() && (bytes[i] == b',' || bytes[i].is_ascii_whitespace()) {
                i += 1;
            }
        }
        if i < bytes.len() {
            i += 1; // consume closing brace
        }
        if !citekey.is_empty() {
            out.push(BibEntry {
                entry_type,
                citekey,
                fields,
            });
        }
    }
    out
}

fn skip_balanced(bytes: &[u8], mut i: usize) -> usize {
    let mut depth: i32 = 1;
    while i < bytes.len() && depth > 0 {
        match bytes[i] {
            b'{' | b'(' => depth += 1,
            b'}' | b')' => depth -= 1,
            _ => {}
        }
        i += 1;
    }
    i
}

fn read_bib_value(rest: &[u8]) -> (String, usize) {
    if rest.is_empty() {
        return (String::new(), 0);
    }
    let mut i = 0;
    match rest[0] {
        b'{' => {
            i = 1;
            let mut depth = 1;
            let mut out = String::new();
            while i < rest.len() && depth > 0 {
                match rest[i] {
                    b'{' => {
                        depth += 1;
                        out.push('{');
                    }
                    b'}' => {
                        depth -= 1;
                        if depth > 0 {
                            out.push('}');
                        }
                    }
                    c => out.push(c as char),
                }
                i += 1;
            }
            (clean_bib_text(&out), i)
        }
        b'"' => {
            i = 1;
            let mut out = String::new();
            while i < rest.len() && rest[i] != b'"' {
                out.push(rest[i] as char);
                i += 1;
            }
            if i < rest.len() {
                i += 1;
            }
            (clean_bib_text(&out), i)
        }
        _ => {
            // Bareword / number / string reference.
            while i < rest.len()
                && rest[i] != b','
                && rest[i] != b'}'
                && rest[i] != b')'
                && rest[i] != b'\n'
            {
                i += 1;
            }
            (
                clean_bib_text(std::str::from_utf8(&rest[..i]).unwrap_or("").trim()),
                i,
            )
        }
    }
}

fn clean_bib_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_ws = false;
    for ch in s.chars() {
        if ch == '{' || ch == '}' || ch == '\\' {
            continue;
        }
        if ch.is_whitespace() {
            if !in_ws && !out.is_empty() {
                out.push(' ');
            }
            in_ws = true;
        } else {
            in_ws = false;
            out.push(ch);
        }
    }
    out.trim().to_string()
}

#[tauri::command]
pub async fn import_zotero_bibtex(
    content: String,
    state: State<'_, AppState>,
) -> AppResult<ZoteroReport> {
    let graph = state.current()?;
    let entries = parse_bibtex(&content);
    let seen = entries.len();
    let mut created = 0usize;
    for entry in entries {
        let page_name = format!("@{}", entry.citekey);
        // Skip if already present.
        if graph.backend.get_page(&page_name.to_lowercase()).await?.is_some() {
            continue;
        }
        let page = graph.backend.create_page(&page_name).await?;
        // Attach properties on a single root block rendered as YAML-ish text.
        let mut lines = Vec::new();
        lines.push(format!("type:: {}", entry.entry_type));
        lines.push(format!("citekey:: {}", entry.citekey));
        for (k, v) in &entry.fields {
            let safe = v.replace('\n', " ");
            lines.push(format!("{k}:: {safe}"));
        }
        let content_block = lines.join("\n");
        graph
            .backend
            .insert_block(&page.id, None, None, &content_block)
            .await?;
        created += 1;
    }
    Ok(ZoteroReport {
        pages_created: created,
        entries_seen: seen,
    })
}

// Silence unused warning when Value is not referenced downstream but kept for
// future callers that want raw JSON export of parsed entries.
#[allow(dead_code)]
fn _reserved(_v: Value) {}
