//! Application runtime state held by Tauri as a managed resource.

use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::RwLock;
use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::graph::Graph;
use crate::model::StorageKind;
use crate::watcher::GraphWatcher;

#[derive(Default)]
pub struct AppState {
    current: RwLock<Option<Arc<Graph>>>,
    watcher: RwLock<Option<GraphWatcher>>,
    recent: RwLock<Vec<PathBuf>>,
}

impl AppState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn open(&self, path: PathBuf, app: AppHandle) -> AppResult<Arc<Graph>> {
        // Tear down any previous watcher before swapping graphs.
        *self.watcher.write() = None;

        let graph = Graph::open(path.clone())?;
        let watcher = if matches!(graph.meta.kind, StorageKind::Markdown) {
            Some(GraphWatcher::start(
                PathBuf::from(&graph.meta.root),
                graph.clone(),
                app,
            )?)
        } else {
            None
        };

        *self.current.write() = Some(graph.clone());
        *self.watcher.write() = watcher;

        let mut recent = self.recent.write();
        recent.retain(|p| p != &path);
        recent.insert(0, path);
        recent.truncate(10);
        Ok(graph)
    }

    pub fn close(&self) {
        *self.watcher.write() = None;
        if let Some(g) = self.current.read().clone() {
            g.backups.stop_scheduler();
        }
        *self.current.write() = None;
    }

    pub fn current(&self) -> AppResult<Arc<Graph>> {
        self.current
            .read()
            .clone()
            .ok_or(AppError::GraphNotOpened)
    }

    pub fn recent(&self) -> Vec<PathBuf> {
        self.recent.read().clone()
    }
}
