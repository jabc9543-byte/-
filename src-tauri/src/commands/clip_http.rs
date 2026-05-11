//! Local HTTP receiver for Web Clipper requests.
//!
//! Listens on `127.0.0.1:CLIP_HTTP_PORT` (default `33333`) so a browser
//! extension can POST clipped articles directly to the desktop app without
//! needing the user to click through a `quanshiwei://` deep-link prompt.
//!
//! Security boundaries:
//!   * Bind address is hard-coded to `127.0.0.1` — never reachable from
//!     another host on the LAN.
//!   * Total request size is capped (`MAX_BODY`) so a runaway browser tab
//!     can't exhaust memory.
//!   * Only two endpoints are accepted; everything else returns 404.
//!   * The payload is plain JSON that maps onto `ClipPayload` — same
//!     validation/sanitisation path as the Tauri command.
//!
//! Implementation note: deliberately written against `tokio::net` directly
//! to avoid pulling in a full HTTP server crate. Parses just enough HTTP/1.1
//! to handle a JSON POST and a CORS preflight.

use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;

use crate::state::AppState;
use super::clipper::{apply_clip, ClipPayload};

const CLIP_HTTP_HOST: &str = "127.0.0.1";
pub const CLIP_HTTP_PORT: u16 = 33333;
const MAX_BODY: usize = 4 * 1024 * 1024; // 4 MiB per clip is plenty
const READ_TIMEOUT: Duration = Duration::from_secs(15);

/// Spawn the receiver on the tokio runtime. If the bind fails (port already
/// in use), logs a warning and returns — the rest of the app keeps running
/// and the user can still receive clips through the `quanshiwei://`
/// deep-link path.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let bind = format!("{CLIP_HTTP_HOST}:{CLIP_HTTP_PORT}");
        let listener = match TcpListener::bind(&bind).await {
            Ok(l) => l,
            Err(e) => {
                tracing::warn!(target: "clip_http", "could not bind {bind}: {e}");
                return;
            }
        };
        tracing::info!(target: "clip_http", "Web Clipper receiver listening on http://{bind}/clip");
        loop {
            match listener.accept().await {
                Ok((sock, peer)) => {
                    if !peer.ip().is_loopback() {
                        // Defence in depth — we bound to 127.0.0.1 already.
                        tracing::warn!(target: "clip_http", "rejecting non-loopback peer {peer}");
                        drop(sock);
                        continue;
                    }
                    let app2 = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = handle_conn(sock, app2).await {
                            tracing::debug!(target: "clip_http", "conn closed: {e}");
                        }
                    });
                }
                Err(e) => {
                    tracing::warn!(target: "clip_http", "accept failed: {e}");
                }
            }
        }
    });
}

async fn handle_conn(mut sock: TcpStream, app: AppHandle) -> std::io::Result<()> {
    // Read the request head + body up to MAX_BODY+slack.
    let mut buf = Vec::with_capacity(8 * 1024);
    let mut tmp = [0u8; 8 * 1024];
    let mut header_end: Option<usize> = None;
    loop {
        let n = match timeout(READ_TIMEOUT, sock.read(&mut tmp)).await {
            Ok(Ok(n)) => n,
            Ok(Err(e)) => return Err(e),
            Err(_) => {
                return write_simple(&mut sock, 408, "Request Timeout", "{\"error\":\"timeout\"}").await;
            }
        };
        if n == 0 {
            break;
        }
        if buf.len() + n > MAX_BODY + 8 * 1024 {
            return write_simple(&mut sock, 413, "Payload Too Large", "{\"error\":\"payload too large\"}").await;
        }
        buf.extend_from_slice(&tmp[..n]);
        if header_end.is_none() {
            if let Some(pos) = find_double_crlf(&buf) {
                header_end = Some(pos + 4);
            }
        }
        if let Some(hend) = header_end {
            let cl = content_length(&buf[..hend]);
            let have = buf.len() - hend;
            if have >= cl {
                break;
            }
        }
    }

    let hend = match header_end {
        Some(h) => h,
        None => {
            return write_simple(&mut sock, 400, "Bad Request", "{\"error\":\"malformed\"}").await;
        }
    };
    let head_str = match std::str::from_utf8(&buf[..hend]) {
        Ok(s) => s,
        Err(_) => {
            return write_simple(&mut sock, 400, "Bad Request", "{\"error\":\"non-utf8 headers\"}").await;
        }
    };
    let mut lines = head_str.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_ascii_uppercase();
    let path = parts.next().unwrap_or("");

    // CORS preflight — accept anything from a localhost browser. We don't
    // need to whitelist origins because the listener is bound to loopback,
    // but we still echo the origin to keep credentialed requests working.
    if method == "OPTIONS" {
        return write_cors_preflight(&mut sock, head_str).await;
    }

    if method == "GET" && (path == "/" || path == "/health") {
        let body = b"{\"ok\":true,\"service\":\"quanshiwei-clipper\"}";
        return write_response(&mut sock, 200, "OK", "application/json", body, true, head_str).await;
    }

    if method != "POST" || path != "/clip" {
        let body = b"{\"error\":\"not found\"}";
        return write_response(&mut sock, 404, "Not Found", "application/json", body, true, head_str).await;
    }

    let body = &buf[hend..];
    let payload: ClipPayload = match serde_json::from_slice(body) {
        Ok(p) => p,
        Err(e) => {
            let msg = format!("{{\"error\":\"invalid json: {}\"}}", e);
            return write_response(&mut sock, 400, "Bad Request", "application/json", msg.as_bytes(), true, head_str).await;
        }
    };

    // `app.state::<AppState>()` is cheap (returns a reference held by the
    // app's managed state map). We pass the inner Arc<AppState> by reference
    // through `apply_clip`.
    let state: tauri::State<'_, AppState> = app.state();
    let result = apply_clip(payload, state.inner()).await;
    let (status, status_text, body_bytes): (u16, &str, Vec<u8>) = match result {
        Ok(r) => match serde_json::to_vec(&r) {
            Ok(v) => (200, "OK", v),
            Err(e) => (500, "Internal Server Error", format!("{{\"error\":\"serialize: {e}\"}}").into_bytes()),
        },
        Err(e) => {
            let body = format!("{{\"error\":\"{}\"}}", e.to_string().replace('"', "\\\""));
            (500, "Internal Server Error", body.into_bytes())
        }
    };

    write_response(&mut sock, status, status_text, "application/json", &body_bytes, true, head_str).await
}

fn find_double_crlf(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

fn content_length(head: &[u8]) -> usize {
    let s = match std::str::from_utf8(head) {
        Ok(s) => s,
        Err(_) => return 0,
    };
    for line in s.split("\r\n") {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") {
                return v.trim().parse().unwrap_or(0);
            }
        }
    }
    0
}

fn extract_header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    for line in head.split("\r\n") {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case(name) {
                return Some(v.trim());
            }
        }
    }
    None
}

fn cors_origin(head: &str) -> String {
    extract_header(head, "Origin").unwrap_or("*").to_string()
}

async fn write_simple(sock: &mut TcpStream, code: u16, status: &str, body: &str) -> std::io::Result<()> {
    write_response(sock, code, status, "application/json", body.as_bytes(), false, "").await
}

async fn write_cors_preflight(sock: &mut TcpStream, head: &str) -> std::io::Result<()> {
    let origin = cors_origin(head);
    let resp = format!(
        "HTTP/1.1 204 No Content\r\n\
         Access-Control-Allow-Origin: {origin}\r\n\
         Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n\
         Access-Control-Allow-Headers: content-type, x-clip-token\r\n\
         Access-Control-Max-Age: 600\r\n\
         Content-Length: 0\r\n\
         Connection: close\r\n\r\n",
    );
    sock.write_all(resp.as_bytes()).await?;
    sock.shutdown().await
}

async fn write_response(
    sock: &mut TcpStream,
    code: u16,
    status: &str,
    content_type: &str,
    body: &[u8],
    with_cors: bool,
    request_head: &str,
) -> std::io::Result<()> {
    let mut head = format!(
        "HTTP/1.1 {code} {status}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {len}\r\n\
         Connection: close\r\n",
        len = body.len(),
    );
    if with_cors {
        let origin = cors_origin(request_head);
        head.push_str(&format!("Access-Control-Allow-Origin: {origin}\r\n"));
        head.push_str("Vary: Origin\r\n");
    }
    head.push_str("\r\n");
    sock.write_all(head.as_bytes()).await?;
    sock.write_all(body).await?;
    sock.shutdown().await
}

// Hidden helper kept for symmetry with the rest of the module; `Arc<AppState>`
// is not actually constructed anywhere because `AppHandle::state` already
// hands us a borrowed reference for the duration of a request.
#[allow(dead_code)]
fn _arc_marker(_x: Arc<AppState>) {}
