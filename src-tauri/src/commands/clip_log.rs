//! In-memory ring buffer of recent Clipper requests for the Settings UI.
//!
//! Stores the last `CAPACITY` request summaries (no body content) so the
//! user can verify clips are coming through and diagnose 401/4xx failures.
//! Entries are kept in process memory only — they vanish on app restart
//! to avoid persisting potentially sensitive page titles to disk.

use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

const CAPACITY: usize = 50;

#[derive(Clone, Serialize, Debug)]
pub struct ClipLogEntry {
    /// Unix millis.
    pub ts: u128,
    pub method: String,
    pub path: String,
    pub status: u16,
    /// Title from the parsed payload, or `None` for non-POST/error paths.
    pub title: Option<String>,
    /// Free-form note: "ok", "unauthorized", "bad json", etc.
    pub note: String,
}

fn buf() -> &'static Mutex<Vec<ClipLogEntry>> {
    static BUF: OnceLock<Mutex<Vec<ClipLogEntry>>> = OnceLock::new();
    BUF.get_or_init(|| Mutex::new(Vec::with_capacity(CAPACITY)))
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

pub fn record(method: &str, path: &str, status: u16, title: Option<String>, note: &str) {
    let entry = ClipLogEntry {
        ts: now_ms(),
        method: method.to_string(),
        path: path.to_string(),
        status,
        title,
        note: note.to_string(),
    };
    if let Ok(mut g) = buf().lock() {
        if g.len() >= CAPACITY {
            g.remove(0);
        }
        g.push(entry);
    }
}

#[tauri::command]
pub async fn clip_log() -> Vec<ClipLogEntry> {
    buf().lock().map(|g| g.clone()).unwrap_or_default()
}

#[tauri::command]
pub async fn clear_clip_log() -> () {
    if let Ok(mut g) = buf().lock() {
        g.clear();
    }
}
