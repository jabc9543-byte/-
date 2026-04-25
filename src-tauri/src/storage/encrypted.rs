//! Transparent block-content encryption decorator over any [`Backend`].
//!
//! When the graph has encryption enabled, blocks are stored with their
//! `content` field replaced by an encrypted wire string. The decorator
//! encrypts before delegating writes and decrypts after every read.
//!
//! When the vault is locked (`KeyRing` empty), all mutating calls fail
//! with "graph is locked"; reads return blocks with their raw ciphertext
//! so the UI can render a locked-state placeholder without panicking.

use std::sync::Arc;

use async_trait::async_trait;

use crate::encryption::KeyRing;
use crate::error::AppResult;
use crate::model::{
    Block, BlockHistoryEntry, BlockId, Page, PageId, SearchHit, StorageKind, Whiteboard,
    WhiteboardSummary,
};
use crate::storage::Backend;

pub struct EncryptedBackend {
    inner: Arc<dyn Backend>,
    keyring: Arc<KeyRing>,
}

impl EncryptedBackend {
    pub fn new(inner: Arc<dyn Backend>, keyring: Arc<KeyRing>) -> Arc<Self> {
        Arc::new(Self { inner, keyring })
    }

    fn decrypt_block(&self, mut b: Block) -> Block {
        if self.keyring.is_active() && self.keyring.is_unlocked() {
            if let Ok(plain) = self.keyring.decrypt(&b.content) {
                b.content = plain;
            }
        }
        b
    }
}

#[async_trait]
impl Backend for EncryptedBackend {
    fn kind(&self) -> StorageKind {
        self.inner.kind()
    }

    async fn list_pages(&self) -> AppResult<Vec<Page>> {
        self.inner.list_pages().await
    }

    async fn get_page(&self, id: &PageId) -> AppResult<Option<Page>> {
        self.inner.get_page(id).await
    }

    async fn create_page(&self, name: &str) -> AppResult<Page> {
        self.inner.create_page(name).await
    }

    async fn delete_page(&self, id: &PageId) -> AppResult<()> {
        self.inner.delete_page(id).await
    }

    async fn rename_page(&self, id: &PageId, new_name: &str) -> AppResult<Page> {
        self.inner.rename_page(id, new_name).await
    }

    async fn set_page_aliases(&self, id: &PageId, aliases: &[String]) -> AppResult<Page> {
        self.inner.set_page_aliases(id, aliases).await
    }

    async fn get_block(&self, id: &BlockId) -> AppResult<Option<Block>> {
        Ok(self.inner.get_block(id).await?.map(|b| self.decrypt_block(b)))
    }

    async fn update_block(&self, id: &BlockId, content: &str) -> AppResult<Block> {
        if !self.keyring.is_active() {
            let b = self.inner.update_block(id, content).await?;
            return Ok(b);
        }
        let ct = self.keyring.encrypt(content)?;
        let b = self.inner.update_block(id, &ct).await?;
        Ok(self.decrypt_block(b))
    }

    async fn insert_block(
        &self,
        page: &PageId,
        parent: Option<BlockId>,
        after: Option<BlockId>,
        content: &str,
    ) -> AppResult<Block> {
        if !self.keyring.is_active() {
            let b = self.inner.insert_block(page, parent, after, content).await?;
            return Ok(b);
        }
        let ct = self.keyring.encrypt(content)?;
        let b = self.inner.insert_block(page, parent, after, &ct).await?;
        Ok(self.decrypt_block(b))
    }

    async fn delete_block(&self, id: &BlockId) -> AppResult<()> {
        self.inner.delete_block(id).await
    }

    async fn move_block(
        &self,
        id: &BlockId,
        new_parent: Option<BlockId>,
        new_order: i64,
    ) -> AppResult<Block> {
        let b = self.inner.move_block(id, new_parent, new_order).await?;
        Ok(self.decrypt_block(b))
    }

    async fn search(&self, query: &str, limit: usize) -> AppResult<Vec<SearchHit>> {
        // Search index is built from plaintext in memory; underlying backend
        // only holds ciphertext snippets, so delegate and decrypt the
        // snippet best-effort (it may already be plaintext if the backend
        // layers its own index).
        let mut hits = self.inner.search(query, limit).await?;
        if self.keyring.is_active() && self.keyring.is_unlocked() {
            for h in &mut hits {
                if let Ok(plain) = self.keyring.decrypt(&h.snippet) {
                    h.snippet = plain;
                }
            }
        }
        Ok(hits)
    }

    async fn backlinks(&self, page_name: &str) -> AppResult<Vec<Block>> {
        let bs = self.inner.backlinks(page_name).await?;
        Ok(bs.into_iter().map(|b| self.decrypt_block(b)).collect())
    }

    async fn all_blocks(&self) -> AppResult<Vec<Block>> {
        let bs = self.inner.all_blocks().await?;
        Ok(bs.into_iter().map(|b| self.decrypt_block(b)).collect())
    }

    async fn reload(&self) -> AppResult<()> {
        self.inner.reload().await
    }

    async fn list_block_history(
        &self,
        block_id: &BlockId,
        limit: usize,
    ) -> AppResult<Vec<BlockHistoryEntry>> {
        let mut entries = self.inner.list_block_history(block_id, limit).await?;
        if self.keyring.is_active() && self.keyring.is_unlocked() {
            for e in &mut entries {
                if let Ok(plain) = self.keyring.decrypt(&e.content) {
                    e.content = plain;
                }
            }
        }
        Ok(entries)
    }

    async fn list_whiteboards(&self) -> AppResult<Vec<WhiteboardSummary>> {
        self.inner.list_whiteboards().await
    }

    async fn get_whiteboard(&self, id: &str) -> AppResult<Option<Whiteboard>> {
        self.inner.get_whiteboard(id).await
    }

    async fn create_whiteboard(&self, name: &str) -> AppResult<Whiteboard> {
        self.inner.create_whiteboard(name).await
    }

    async fn save_whiteboard(
        &self,
        id: &str,
        data: serde_json::Value,
    ) -> AppResult<Whiteboard> {
        self.inner.save_whiteboard(id, data).await
    }

    async fn delete_whiteboard(&self, id: &str) -> AppResult<()> {
        self.inner.delete_whiteboard(id).await
    }

    async fn rename_whiteboard(&self, id: &str, new_name: &str) -> AppResult<Whiteboard> {
        self.inner.rename_whiteboard(id, new_name).await
    }
}
