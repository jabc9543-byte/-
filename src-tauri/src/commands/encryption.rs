//! End-to-end encryption commands.

use serde::Serialize;
use tauri::State;

use crate::encryption::{self, EncryptionMeta};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct EncryptionStatus {
    pub enabled: bool,
    pub unlocked: bool,
    pub meta: Option<EncryptionMeta>,
}

#[tauri::command]
pub fn encryption_status(state: State<'_, AppState>) -> AppResult<EncryptionStatus> {
    let g = state.current()?;
    let meta = encryption::load_meta(&g.encryption_meta_path)?;
    Ok(EncryptionStatus {
        enabled: meta.is_some(),
        unlocked: g.keyring.is_unlocked(),
        meta,
    })
}

#[tauri::command]
pub async fn enable_encryption(
    passphrase: String,
    state: State<'_, AppState>,
) -> AppResult<EncryptionStatus> {
    let g = state.current()?;
    if encryption::load_meta(&g.encryption_meta_path)?.is_some() {
        return Err(AppError::Other("encryption already enabled".into()));
    }
    let (key, meta) = encryption::enable(&g.encryption_meta_path, &passphrase)?;
    g.keyring.set(key);
    g.keyring.set_active(true);
    // Re-encrypt every existing block through the wrapped backend.
    let blocks = g.backend.all_blocks().await?;
    for b in blocks {
        g.backend.update_block(&b.id, &b.content).await?;
    }
    Ok(EncryptionStatus {
        enabled: true,
        unlocked: true,
        meta: Some(meta),
    })
}

#[tauri::command]
pub fn unlock_encryption(
    passphrase: String,
    state: State<'_, AppState>,
) -> AppResult<EncryptionStatus> {
    let g = state.current()?;
    let meta = encryption::load_meta(&g.encryption_meta_path)?
        .ok_or_else(|| AppError::Other("encryption not enabled".into()))?;
    let key = encryption::unlock(&meta, &passphrase)?;
    g.keyring.set(key);
    g.keyring.set_active(true);
    Ok(EncryptionStatus {
        enabled: true,
        unlocked: true,
        meta: Some(meta),
    })
}

#[tauri::command]
pub fn lock_encryption(state: State<'_, AppState>) -> AppResult<EncryptionStatus> {
    let g = state.current()?;
    g.keyring.clear();
    let meta = encryption::load_meta(&g.encryption_meta_path)?;
    Ok(EncryptionStatus {
        enabled: meta.is_some(),
        unlocked: false,
        meta,
    })
}

#[tauri::command]
pub async fn change_encryption_passphrase(
    old_passphrase: String,
    new_passphrase: String,
    state: State<'_, AppState>,
) -> AppResult<EncryptionStatus> {
    let g = state.current()?;
    if encryption::load_meta(&g.encryption_meta_path)?.is_none() {
        return Err(AppError::Other("encryption not enabled".into()));
    }
    // Ensure current vault is accessible before rotating.
    let meta = encryption::load_meta(&g.encryption_meta_path)?.unwrap();
    let _old_key = encryption::unlock(&meta, &old_passphrase)?;
    // Generate new meta (new salt + key). We must first decrypt all blocks
    // with the OLD key, then rotate, then re-encrypt with the new key.
    // The decorator is currently bound to `g.keyring`, which is mutable.
    // Decrypt-pass: temporarily ensure we're using the old key.
    g.keyring.set(_old_key);
    g.keyring.set_active(true);
    let plaintexts: Vec<(String, String)> = g
        .backend
        .all_blocks()
        .await?
        .into_iter()
        .map(|b| (b.id, b.content))
        .collect();
    // Rotate to new key.
    let (new_key, new_meta) =
        encryption::change_passphrase(&g.encryption_meta_path, &old_passphrase, &new_passphrase)?;
    g.keyring.set(new_key);
    g.keyring.set_active(true);
    for (id, plain) in plaintexts {
        g.backend.update_block(&id, &plain).await?;
    }
    Ok(EncryptionStatus {
        enabled: true,
        unlocked: true,
        meta: Some(new_meta),
    })
}

#[tauri::command]
pub async fn disable_encryption(
    passphrase: String,
    state: State<'_, AppState>,
) -> AppResult<EncryptionStatus> {
    let g = state.current()?;
    let meta = encryption::load_meta(&g.encryption_meta_path)?
        .ok_or_else(|| AppError::Other("encryption not enabled".into()))?;
    let key = encryption::unlock(&meta, &passphrase)?;
    g.keyring.set(key);
    g.keyring.set_active(true);
    // Decrypt every block and write plaintext back.
    let plaintexts: Vec<(String, String)> = g
        .backend
        .all_blocks()
        .await?
        .into_iter()
        .map(|b| (b.id, b.content))
        .collect();
    // Turn encryption off; now writes go through as plaintext.
    g.keyring.set_active(false);
    g.keyring.clear();
    for (id, plain) in plaintexts {
        g.backend.update_block(&id, &plain).await?;
    }
    encryption::disable(&g.encryption_meta_path)?;
    Ok(EncryptionStatus {
        enabled: false,
        unlocked: false,
        meta: None,
    })
}
