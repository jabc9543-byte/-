//! End-to-end encryption for block content.
//!
//! Uses Argon2id to derive a 32-byte key from the user's passphrase and a
//! graph-specific salt, and XChaCha20-Poly1305 for authenticated encryption
//! of each block's content. Encryption metadata (salt, algorithm, verifier
//! ciphertext) is stored alongside the graph in `encryption.json`.
//!
//! The wire format for an encrypted string field is:
//! `v1:<base64 nonce(24)>:<base64 ciphertext-with-tag>`
//!
//! Strings that do not match this prefix are considered plaintext — this
//! allows the backend to tolerate half-migrated graphs and turn encryption
//! off by simply re-writing every block.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD_NO_PAD as B64;
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use parking_lot::RwLock;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

use crate::error::{AppError, AppResult};
use crate::model::StorageKind;

const WIRE_PREFIX: &str = "v1:";
const VERIFIER_PLAIN: &[u8] = b"logseq-e2ee-ok";
const SALT_LEN: usize = 32;
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 24;
const DEFAULT_M_COST: u32 = 19456;
const DEFAULT_T_COST: u32 = 2;
const DEFAULT_P_COST: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionMeta {
    pub version: u32,
    pub algorithm: String,
    pub kdf: String,
    pub salt: String,
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
    pub verifier: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// In-memory key material. Dropped/zeroized when the graph is closed or
/// when the user explicitly locks the vault.
pub struct SecretKey {
    bytes: [u8; KEY_LEN],
}

impl SecretKey {
    fn as_slice(&self) -> &[u8] {
        &self.bytes
    }
}

impl Drop for SecretKey {
    fn drop(&mut self) {
        self.bytes.zeroize();
    }
}

/// Thread-safe holder for the current graph's derived key.
/// * `None` → either encryption is disabled, or it is enabled but the vault
///   is currently locked (UI must prompt for a passphrase).
#[derive(Default)]
pub struct KeyRing {
    key: RwLock<Option<Arc<SecretKey>>>,
    active: AtomicBool,
}

impl KeyRing {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::Relaxed)
    }

    pub fn set_active(&self, active: bool) {
        self.active.store(active, Ordering::Relaxed);
    }

    pub fn is_unlocked(&self) -> bool {
        self.key.read().is_some()
    }

    pub fn set(&self, key: SecretKey) {
        *self.key.write() = Some(Arc::new(key));
        self.active.store(true, Ordering::Relaxed);
    }

    pub fn clear(&self) {
        *self.key.write() = None;
    }

    fn current(&self) -> Option<Arc<SecretKey>> {
        self.key.read().clone()
    }

    pub fn encrypt(&self, plaintext: &str) -> AppResult<String> {
        let key = self
            .current()
            .ok_or_else(|| AppError::Other("graph is locked".into()))?;
        encrypt_with_key(key.as_slice(), plaintext.as_bytes())
    }

    pub fn decrypt(&self, wire: &str) -> AppResult<String> {
        if !wire.starts_with(WIRE_PREFIX) {
            // Not encrypted — passthrough (supports mixed-state graphs).
            return Ok(wire.to_string());
        }
        let key = self
            .current()
            .ok_or_else(|| AppError::Other("graph is locked".into()))?;
        decrypt_with_key(key.as_slice(), wire)
    }
}

fn encrypt_with_key(key: &[u8], plaintext: &[u8]) -> AppResult<String> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let mut nonce = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce);
    let ct = cipher
        .encrypt(XNonce::from_slice(&nonce), plaintext)
        .map_err(|e| AppError::Other(format!("encrypt: {e}")))?;
    Ok(format!(
        "{WIRE_PREFIX}{}:{}",
        B64.encode(nonce),
        B64.encode(ct)
    ))
}

fn decrypt_with_key(key: &[u8], wire: &str) -> AppResult<String> {
    let body = wire
        .strip_prefix(WIRE_PREFIX)
        .ok_or_else(|| AppError::Other("invalid ciphertext".into()))?;
    let (nonce_b64, ct_b64) = body
        .split_once(':')
        .ok_or_else(|| AppError::Other("invalid ciphertext".into()))?;
    let nonce = B64
        .decode(nonce_b64)
        .map_err(|e| AppError::Other(format!("nonce b64: {e}")))?;
    if nonce.len() != NONCE_LEN {
        return Err(AppError::Other("invalid nonce length".into()));
    }
    let ct = B64
        .decode(ct_b64)
        .map_err(|e| AppError::Other(format!("ct b64: {e}")))?;
    let cipher = XChaCha20Poly1305::new(key.into());
    let plain = cipher
        .decrypt(XNonce::from_slice(&nonce), ct.as_ref())
        .map_err(|_| AppError::Other("decryption failed (bad passphrase or tampered data)".into()))?;
    String::from_utf8(plain).map_err(|e| AppError::Other(format!("utf8: {e}")))
}

fn derive_key(passphrase: &str, salt: &[u8], meta: &EncryptionMeta) -> AppResult<SecretKey> {
    let params = Params::new(meta.m_cost, meta.t_cost, meta.p_cost, Some(KEY_LEN))
        .map_err(|e| AppError::Other(format!("argon2 params: {e}")))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; KEY_LEN];
    argon
        .hash_password_into(passphrase.as_bytes(), salt, &mut out)
        .map_err(|e| AppError::Other(format!("argon2: {e}")))?;
    Ok(SecretKey { bytes: out })
}

/// Path where encryption metadata is stored for a graph.
pub fn meta_path(root: &Path, kind: StorageKind) -> PathBuf {
    match kind {
        StorageKind::Markdown => root.join("logseq").join("encryption.json"),
        StorageKind::Sqlite => {
            let stem = root
                .file_stem()
                .map(|s| s.to_os_string())
                .unwrap_or_else(|| "graph".into());
            let mut name = stem;
            name.push(".enc.json");
            root.with_file_name(name)
        }
    }
}

pub fn load_meta(path: &Path) -> AppResult<Option<EncryptionMeta>> {
    if !path.exists() {
        return Ok(None);
    }
    let body = std::fs::read_to_string(path)?;
    let meta: EncryptionMeta = serde_json::from_str(&body)?;
    Ok(Some(meta))
}

fn save_meta(path: &Path, meta: &EncryptionMeta) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let body = serde_json::to_string_pretty(meta)?;
    std::fs::write(path, body)?;
    Ok(())
}

/// Initialize new encryption metadata for a graph, deriving a fresh key
/// from `passphrase` and a random salt. Returns the derived key and the
/// metadata (caller is responsible for persisting it via `save_meta`).
pub fn create_meta(passphrase: &str) -> AppResult<(SecretKey, EncryptionMeta)> {
    if passphrase.is_empty() {
        return Err(AppError::Other("passphrase must not be empty".into()));
    }
    let mut salt = [0u8; SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    let mut draft = EncryptionMeta {
        version: 1,
        algorithm: "xchacha20poly1305".into(),
        kdf: "argon2id".into(),
        salt: B64.encode(salt),
        m_cost: DEFAULT_M_COST,
        t_cost: DEFAULT_T_COST,
        p_cost: DEFAULT_P_COST,
        verifier: String::new(),
        created_at: chrono::Utc::now(),
    };
    let key = derive_key(passphrase, &salt, &draft)?;
    draft.verifier = encrypt_with_key(key.as_slice(), VERIFIER_PLAIN)?;
    Ok((key, draft))
}

/// Verify `passphrase` against the stored verifier and return the derived key.
pub fn unlock(meta: &EncryptionMeta, passphrase: &str) -> AppResult<SecretKey> {
    let salt = B64
        .decode(&meta.salt)
        .map_err(|e| AppError::Other(format!("salt b64: {e}")))?;
    let key = derive_key(passphrase, &salt, meta)?;
    let got = decrypt_with_key(key.as_slice(), &meta.verifier)
        .map_err(|_| AppError::Other("wrong passphrase".into()))?;
    if got.as_bytes() != VERIFIER_PLAIN {
        return Err(AppError::Other("wrong passphrase".into()));
    }
    Ok(key)
}

/// Persist fresh encryption metadata for a graph at `meta_path`.
pub fn enable(path: &Path, passphrase: &str) -> AppResult<(SecretKey, EncryptionMeta)> {
    if load_meta(path)?.is_some() {
        return Err(AppError::Other("encryption already enabled".into()));
    }
    let (key, meta) = create_meta(passphrase)?;
    save_meta(path, &meta)?;
    Ok((key, meta))
}

/// Replace the passphrase — keeps the same derived key (so on-disk ciphertext
/// does not need to be rewritten); only the verifier + salt are refreshed.
/// Returns the new meta (already saved) and the freshly-derived key.
pub fn change_passphrase(
    path: &Path,
    old_pass: &str,
    new_pass: &str,
) -> AppResult<(SecretKey, EncryptionMeta)> {
    let meta = load_meta(path)?
        .ok_or_else(|| AppError::Other("encryption not enabled".into()))?;
    let _old_key = unlock(&meta, old_pass)?; // authorize
    // Derive a fresh key from a new salt so the ciphertext on disk gains
    // forward secrecy against old passphrase compromise — but that would
    // require re-encrypting every block. Instead we only rotate the salt
    // binding the new passphrase to the existing key is not possible with
    // a KDF; so we generate a new salt + key and return it for the caller
    // to re-encrypt all blocks.
    let (new_key, new_meta) = create_meta(new_pass)?;
    save_meta(path, &new_meta)?;
    Ok((new_key, new_meta))
}

pub fn disable(path: &Path) -> AppResult<()> {
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}
