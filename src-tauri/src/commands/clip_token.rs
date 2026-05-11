//! Token for the local HTTP Clipper receiver.
//!
//! Although the receiver is bound to `127.0.0.1`, *any* process on the same
//! machine (rogue browser extension, malware, another app) can still reach
//! it. A pre-shared token gates the `POST /clip` endpoint so only callers
//! who can read the token file (i.e. processes running as the same user
//! with filesystem access) can push clips.
//!
//! The token is generated on first launch, persisted under
//! `app_local_data_dir/clip-token.txt` with 0600-ish permissions where the
//! OS supports it, and surfaced to the UI through `get_clip_token`.

use std::path::PathBuf;
use std::sync::RwLock;

use rand::RngCore;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

const TOKEN_FILE: &str = "clip-token.txt";
const TOKEN_BYTES: usize = 24; // 192 bits → 32 chars base64-url-ish

static CACHED: RwLock<Option<String>> = RwLock::new(None);

fn token_path(app: &AppHandle) -> AppResult<PathBuf> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::Other(format!("resolve app_local_data_dir: {e}")))?;
    std::fs::create_dir_all(&base)?;
    Ok(base.join(TOKEN_FILE))
}

fn encode(bytes: &[u8]) -> String {
    // Base64url-ish without padding. Avoids '/' '+' '=' so the token can be
    // pasted into URLs and shell snippets without escaping.
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(((bytes.len() * 8) + 5) / 6);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for b in bytes {
        buf = (buf << 8) | u32::from(*b);
        bits += 8;
        while bits >= 6 {
            bits -= 6;
            let idx = ((buf >> bits) & 0x3f) as usize;
            out.push(char::from(ALPHABET[idx]));
        }
    }
    if bits > 0 {
        let idx = ((buf << (6 - bits)) & 0x3f) as usize;
        out.push(char::from(ALPHABET[idx]));
    }
    out
}

fn generate() -> String {
    let mut bytes = [0u8; TOKEN_BYTES];
    rand::thread_rng().fill_bytes(&mut bytes);
    encode(&bytes)
}

/// Load the token from disk, generating + persisting it on first call.
/// Subsequent calls return the cached value without touching disk.
pub fn load_or_init(app: &AppHandle) -> AppResult<String> {
    if let Some(t) = CACHED.read().ok().and_then(|g| g.clone()) {
        return Ok(t);
    }
    let path = token_path(app)?;
    let token = match std::fs::read_to_string(&path) {
        Ok(s) => {
            let trimmed = s.trim();
            if trimmed.len() >= 16 {
                trimmed.to_string()
            } else {
                let fresh = generate();
                std::fs::write(&path, &fresh)?;
                fresh
            }
        }
        Err(_) => {
            let fresh = generate();
            std::fs::write(&path, &fresh)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
            }
            fresh
        }
    };
    if let Ok(mut g) = CACHED.write() {
        *g = Some(token.clone());
    }
    Ok(token)
}

/// Constant-time-ish compare to mitigate trivial timing leaks. The token is
/// short and the listener is loopback-only, so this is mostly defensive.
pub fn eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.bytes().zip(b.bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[tauri::command]
pub async fn get_clip_token(app: AppHandle) -> AppResult<String> {
    load_or_init(&app)
}

#[tauri::command]
pub async fn rotate_clip_token(app: AppHandle) -> AppResult<String> {
    let path = token_path(&app)?;
    let fresh = generate();
    std::fs::write(&path, &fresh)?;
    if let Ok(mut g) = CACHED.write() {
        *g = Some(fresh.clone());
    }
    Ok(fresh)
}
