//! Filesystem watcher for Markdown graphs.
//!
//! Watches `pages/`, `journals/` and `whiteboards/` under the graph root.
//! Debounces raw `notify` events (default 300ms of quiescence), triggers a
//! backend `reload()`, and emits a `graph:changed` Tauri event carrying the
//! changed paths so the frontend can refresh.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::Arc;
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use crate::error::AppResult;
use crate::graph::Graph;

const DEBOUNCE: Duration = Duration::from_millis(300);
const POLL: Duration = Duration::from_millis(100);

pub struct GraphWatcher {
    _watcher: RecommendedWatcher,
    stop: Arc<AtomicBool>,
}

impl GraphWatcher {
    pub fn start(root: PathBuf, graph: Arc<Graph>, app: AppHandle) -> AppResult<Self> {
        let stop = Arc::new(AtomicBool::new(false));
        let (tx, rx) = channel::<notify::Result<notify::Event>>();

        let mut watcher = notify::recommended_watcher(move |res| {
            // Drop events silently if the receiver is gone.
            let _ = tx.send(res);
        })
        .map_err(|e| crate::error::AppError::Other(e.to_string()))?;

        for sub in ["pages", "journals", "whiteboards"] {
            let p = root.join(sub);
            if p.exists() {
                watcher
                    .watch(&p, RecursiveMode::Recursive)
                    .map_err(|e| crate::error::AppError::Other(e.to_string()))?;
            }
        }

        let stop_cl = stop.clone();
        std::thread::Builder::new()
            .name("logseq-rs.fs-watcher".into())
            .spawn(move || {
                let mut pending: Vec<PathBuf> = Vec::new();
                let mut last_evt: Option<Instant> = None;
                loop {
                    if stop_cl.load(Ordering::Relaxed) {
                        break;
                    }
                    match rx.recv_timeout(POLL) {
                        Ok(Ok(evt)) => {
                            for p in evt.paths {
                                if !pending.contains(&p) {
                                    pending.push(p);
                                }
                            }
                            last_evt = Some(Instant::now());
                        }
                        Ok(Err(err)) => {
                            tracing::warn!(?err, "fs watcher error");
                        }
                        Err(RecvTimeoutError::Timeout) => {}
                        Err(RecvTimeoutError::Disconnected) => break,
                    }

                    if let Some(t) = last_evt {
                        if t.elapsed() >= DEBOUNCE && !pending.is_empty() {
                            let paths: Vec<String> = pending
                                .drain(..)
                                .map(|p| p.to_string_lossy().into_owned())
                                .collect();
                            last_evt = None;
                            let graph = graph.clone();
                            let app = app.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) = graph.backend.reload().await {
                                    tracing::warn!(?e, "backend reload failed");
                                }
                                if let Err(e) = graph.rebuild_search_index().await {
                                    tracing::warn!(?e, "search index rebuild failed");
                                }
                                if let Err(e) = app.emit("graph:changed", &paths) {
                                    tracing::warn!(?e, "emit graph:changed failed");
                                }
                            });
                        }
                    }
                }
            })
            .map_err(|e| crate::error::AppError::Other(e.to_string()))?;

        Ok(Self {
            _watcher: watcher,
            stop,
        })
    }
}

impl Drop for GraphWatcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}
