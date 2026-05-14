//! Server-side HTTP fetch for plugins.
//!
//! Plugins run inside a Web Worker whose `fetch()` is bound by the WebView's
//! same-origin policy. Calling third-party endpoints (e.g. `wttr.in`,
//! `quotable.io`) would therefore fail with a CORS error even though the
//! request is harmless. Route every plugin HTTP call through this Tauri
//! command instead so it goes out through `reqwest` and bypasses CORS.

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const MAX_BYTES: usize = 2 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Deserialize)]
pub struct PluginFetchInit {
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PluginFetchResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

#[tauri::command]
pub async fn plugin_http_fetch(
    url: String,
    init: Option<PluginFetchInit>,
) -> AppResult<PluginFetchResponse> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(AppError::Invalid("only http(s) URLs allowed".into()));
    }
    let init = init.unwrap_or(PluginFetchInit {
        method: None,
        headers: None,
        body: None,
    });
    let method_str = init.method.unwrap_or_else(|| "GET".to_string()).to_uppercase();
    let method = reqwest::Method::from_bytes(method_str.as_bytes())
        .map_err(|e| AppError::Invalid(format!("bad method: {e}")))?;

    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent(concat!(
            "quanshiwei/", env!("CARGO_PKG_VERSION"), " (+plugin-net)"
        ))
        .build()
        .map_err(|e| AppError::Other(format!("http client: {e}")))?;

    let mut req = client.request(method, &url);
    if let Some(headers) = init.headers {
        for (k, v) in headers {
            req = req.header(k, v);
        }
    }
    if let Some(body) = init.body {
        req = req.body(body);
    }

    let res = req
        .send()
        .await
        .map_err(|e| AppError::Other(format!("http send: {e}")))?;
    let status = res.status().as_u16();
    let mut headers = HashMap::new();
    for (k, v) in res.headers() {
        if let Ok(s) = v.to_str() {
            headers.insert(k.as_str().to_string(), s.to_string());
        }
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|e| AppError::Other(format!("http read: {e}")))?;
    if bytes.len() > MAX_BYTES {
        return Err(AppError::Invalid(format!(
            "response body exceeds {} MiB cap",
            MAX_BYTES / (1024 * 1024)
        )));
    }
    let body = String::from_utf8_lossy(&bytes).into_owned();
    Ok(PluginFetchResponse { status, headers, body })
}
