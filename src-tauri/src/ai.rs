//! Text AI assistant (module 21).
//!
//! Per-graph configuration for an OpenAI-compatible chat completions
//! endpoint. Supports streaming (SSE) and non-streaming completions,
//! and a few built-in "recipes" (summarise, translate, improve, continue)
//! that are expanded into a chat message list on the backend.
//!
//! Wire flow:
//! * `ai_complete` — blocking; returns the full assistant reply.
//! * `ai_complete_stream` — spawns a task that streams deltas as Tauri
//!   events `ai://delta-<session>`, `ai://done-<session>` and
//!   `ai://error-<session>`. The caller supplies the session id so the
//!   UI can cancel by simply ignoring further events.
//!
//! Secrets (`api_key`) are written back to disk verbatim; treat the
//! graph directory with the same trust level as your Logseq vault.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use futures_util::StreamExt;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};
use crate::model::StorageKind;

const CONFIG_FILE: &str = "ai-config.json";
const DEFAULT_MODEL: &str = "gpt-4o-mini";
const DEFAULT_ENDPOINT: &str = "https://api.openai.com/v1/chat/completions";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub enabled: bool,
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub system_prompt: String,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            endpoint: DEFAULT_ENDPOINT.to_string(),
            api_key: String::new(),
            model: DEFAULT_MODEL.to_string(),
            temperature: 0.7,
            max_tokens: 1024,
            system_prompt:
                "You are a helpful writing assistant embedded in a Logseq-like \
                 knowledge graph. Respond in the same language as the user. \
                 Keep answers concise and well-formatted in Markdown."
                    .to_string(),
        }
    }
}

/// Sanitised config returned to the UI: the API key is replaced with a
/// fixed sentinel so it never round-trips through the renderer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfigView {
    pub enabled: bool,
    pub endpoint: String,
    pub has_api_key: bool,
    pub model: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub system_prompt: String,
}

impl From<&AiConfig> for AiConfigView {
    fn from(c: &AiConfig) -> Self {
        Self {
            enabled: c.enabled,
            endpoint: c.endpoint.clone(),
            has_api_key: !c.api_key.is_empty(),
            model: c.model.clone(),
            temperature: c.temperature,
            max_tokens: c.max_tokens,
            system_prompt: c.system_prompt.clone(),
        }
    }
}

/// Patch from the UI. `api_key` is only written when `Some`; pass
/// `Some("")` to clear it, `None` to leave it unchanged.
#[derive(Debug, Clone, Deserialize)]
pub struct AiConfigPatch {
    pub enabled: Option<bool>,
    pub endpoint: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub system_prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiMessage {
    /// "system" | "user" | "assistant"
    pub role: String,
    pub content: String,
}

pub struct AiManager {
    config_path: PathBuf,
    config: RwLock<AiConfig>,
    client: reqwest::Client,
}

impl AiManager {
    pub fn open(root: PathBuf, kind: StorageKind) -> AppResult<Arc<Self>> {
        let config_path = config_path(&root, kind);
        if let Some(parent) = config_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let config = load_config(&config_path)?.unwrap_or_default();
        let client = reqwest::Client::builder()
            .user_agent("logseq-rs/0.1")
            .build()
            .map_err(|e| AppError::Other(format!("http client: {e}")))?;
        Ok(Arc::new(Self {
            config_path,
            config: RwLock::new(config),
            client,
        }))
    }

    pub fn config_view(&self) -> AiConfigView {
        AiConfigView::from(&*self.config.read())
    }

    pub fn set_config(&self, patch: AiConfigPatch) -> AppResult<AiConfigView> {
        {
            let mut cfg = self.config.write();
            if let Some(v) = patch.enabled {
                cfg.enabled = v;
            }
            if let Some(v) = patch.endpoint {
                cfg.endpoint = v;
            }
            if let Some(v) = patch.api_key {
                cfg.api_key = v;
            }
            if let Some(v) = patch.model {
                cfg.model = v;
            }
            if let Some(v) = patch.temperature {
                cfg.temperature = v.clamp(0.0, 2.0);
            }
            if let Some(v) = patch.max_tokens {
                cfg.max_tokens = v.clamp(16, 32_768);
            }
            if let Some(v) = patch.system_prompt {
                cfg.system_prompt = v;
            }
            save_config(&self.config_path, &cfg)?;
        }
        Ok(self.config_view())
    }

    fn snapshot(&self) -> AppResult<AiConfig> {
        let cfg = self.config.read().clone();
        if !cfg.enabled {
            return Err(AppError::Invalid("AI assistant disabled".into()));
        }
        if cfg.endpoint.is_empty() {
            return Err(AppError::Invalid("AI endpoint not set".into()));
        }
        Ok(cfg)
    }

    /// Build the request body from a user-supplied message list.
    fn build_body(&self, cfg: &AiConfig, messages: &[AiMessage], stream: bool) -> Value {
        let mut msgs: Vec<Value> = Vec::with_capacity(messages.len() + 1);
        if !cfg.system_prompt.trim().is_empty() {
            msgs.push(json!({ "role": "system", "content": cfg.system_prompt }));
        }
        for m in messages {
            msgs.push(json!({ "role": m.role, "content": m.content }));
        }
        json!({
            "model": cfg.model,
            "messages": msgs,
            "temperature": cfg.temperature,
            "max_tokens": cfg.max_tokens,
            "stream": stream,
        })
    }

    /// Non-streaming chat completion. Returns the full assistant message.
    pub async fn complete(&self, messages: Vec<AiMessage>) -> AppResult<String> {
        let cfg = self.snapshot()?;
        let body = self.build_body(&cfg, &messages, false);
        let mut req = self.client.post(&cfg.endpoint).json(&body);
        if !cfg.api_key.is_empty() {
            req = req.bearer_auth(&cfg.api_key);
        }
        let res = req
            .send()
            .await
            .map_err(|e| AppError::Other(format!("ai request: {e}")))?;
        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            return Err(AppError::Other(format!(
                "ai {status}: {}",
                truncate(&text, 400)
            )));
        }
        let payload: Value = res
            .json()
            .await
            .map_err(|e| AppError::Other(format!("ai decode: {e}")))?;
        let content = payload
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        Ok(content)
    }

    /// Streaming chat completion. Spawns a task and returns immediately.
    /// Events are emitted on:
    ///   * `ai://delta-<session>` — payload: string chunk
    ///   * `ai://done-<session>`  — payload: full text
    ///   * `ai://error-<session>` — payload: error string
    pub fn complete_stream(
        self: Arc<Self>,
        app: AppHandle,
        session: String,
        messages: Vec<AiMessage>,
    ) -> AppResult<()> {
        let cfg = self.snapshot()?;
        let body = self.build_body(&cfg, &messages, true);
        let client = self.client.clone();
        let delta_ev = format!("ai://delta-{session}");
        let done_ev = format!("ai://done-{session}");
        let err_ev = format!("ai://error-{session}");
        tokio::spawn(async move {
            let mut req = client.post(&cfg.endpoint).json(&body);
            if !cfg.api_key.is_empty() {
                req = req.bearer_auth(&cfg.api_key);
            }
            let res = match req.send().await {
                Ok(r) => r,
                Err(e) => {
                    let _ = app.emit(&err_ev, format!("request: {e}"));
                    return;
                }
            };
            if !res.status().is_success() {
                let status = res.status();
                let text = res.text().await.unwrap_or_default();
                let _ = app.emit(&err_ev, format!("{status}: {}", truncate(&text, 400)));
                return;
            }
            let mut stream = res.bytes_stream();
            let mut buf = Vec::<u8>::new();
            let mut full = String::new();
            while let Some(chunk) = stream.next().await {
                let bytes = match chunk {
                    Ok(b) => b,
                    Err(e) => {
                        let _ = app.emit(&err_ev, format!("stream: {e}"));
                        return;
                    }
                };
                buf.extend_from_slice(&bytes);
                // Split on SSE event boundary (blank line).
                while let Some(pos) = find_event_end(&buf) {
                    let event: Vec<u8> = buf.drain(..pos + 2).collect();
                    let event = &event[..event.len() - 2]; // strip trailing \n\n or \r\n\r\n
                    for line in event.split(|b| *b == b'\n') {
                        let line = trim_cr(line);
                        if !line.starts_with(b"data:") {
                            continue;
                        }
                        let data = line[5..].trim_ascii_start();
                        if data == b"[DONE]" {
                            let _ = app.emit(&done_ev, full.clone());
                            return;
                        }
                        let Ok(v) = serde_json::from_slice::<Value>(data) else {
                            continue;
                        };
                        if let Some(delta) = v
                            .get("choices")
                            .and_then(|c| c.get(0))
                            .and_then(|c| c.get("delta"))
                            .and_then(|d| d.get("content"))
                            .and_then(|s| s.as_str())
                        {
                            if !delta.is_empty() {
                                full.push_str(delta);
                                let _ = app.emit(&delta_ev, delta.to_string());
                            }
                        }
                    }
                }
            }
            let _ = app.emit(&done_ev, full);
        });
        Ok(())
    }
}

fn find_event_end(buf: &[u8]) -> Option<usize> {
    // Return index of the first byte of a "\n\n" (or "\r\n\r\n") terminator.
    for i in 0..buf.len().saturating_sub(1) {
        if buf[i] == b'\n' && buf[i + 1] == b'\n' {
            return Some(i);
        }
        if i + 3 < buf.len()
            && buf[i] == b'\r'
            && buf[i + 1] == b'\n'
            && buf[i + 2] == b'\r'
            && buf[i + 3] == b'\n'
        {
            return Some(i + 2);
        }
    }
    None
}

fn trim_cr(line: &[u8]) -> &[u8] {
    if let Some((last, rest)) = line.split_last() {
        if *last == b'\r' {
            return rest;
        }
    }
    line
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max).collect();
        out.push('…');
        out
    }
}

fn config_path(root: &Path, kind: StorageKind) -> PathBuf {
    match kind {
        StorageKind::Markdown => root.join(CONFIG_FILE),
        StorageKind::Sqlite => {
            let stem = root
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "graph".to_string());
            let parent = root.parent().unwrap_or(Path::new("."));
            parent.join(format!("{stem}.{CONFIG_FILE}"))
        }
    }
}

fn load_config(path: &Path) -> AppResult<Option<AiConfig>> {
    if !path.exists() {
        return Ok(None);
    }
    let data = std::fs::read(path)?;
    let cfg: AiConfig = serde_json::from_slice(&data)?;
    Ok(Some(cfg))
}

fn save_config(path: &Path, cfg: &AiConfig) -> AppResult<()> {
    let data = serde_json::to_vec_pretty(cfg)?;
    std::fs::write(path, data)?;
    Ok(())
}
