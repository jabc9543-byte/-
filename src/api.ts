// Thin typed wrapper over the Tauri `invoke` API.
import { invoke } from "@tauri-apps/api/core";
import type {
  Block,
  BlockId,
  GraphMeta,
  Page,
  PageId,
  QueryExpr,
  SearchHit,
  TaskMarker,
  Whiteboard,
  WhiteboardSummary,
  GraphStats,
  CalendarCell,
  TemplateInfo,
  BacklinkGroup,
  BlockContext,
  DashboardStats,
  AgendaItem,
  UpdateInfo,
  AppVersionInfo,
  BlockHistoryEntry,
  EncryptionStatus,
  Comment,
  BackupConfig,
  BackupEntry,
  AiConfigView,
  AiConfigPatch,
  AiMessage,
} from "./types";
export const api = {
  // graph
  openGraph: (path: string) => invoke<GraphMeta>("open_graph", { path }),
  closeGraph: () => invoke<void>("close_graph"),
  currentGraph: () => invoke<GraphMeta | null>("current_graph"),
  listGraphs: () => invoke<string[]>("list_graphs"),
  graphStats: () => invoke<GraphStats>("graph_stats"),
  reloadGraph: () => invoke<void>("reload_graph"),

  // pages
  listPages: () => invoke<Page[]>("list_pages"),
  getPage: (id: PageId) => invoke<Page | null>("get_page", { id }),
  createPage: (name: string) => invoke<Page>("create_page", { name }),
  deletePage: (id: PageId) => invoke<void>("delete_page", { id }),
  renamePage: (id: PageId, newName: string) =>
    invoke<Page>("rename_page", { id, newName }),
  setPageAliases: (id: PageId, aliases: string[]) =>
    invoke<Page>("set_page_aliases", { id, aliases }),
  resolvePage: (name: string) =>
    invoke<Page | null>("resolve_page", { name }),

  // blocks
  getBlock: (id: BlockId) => invoke<Block | null>("get_block", { id }),
  updateBlock: (id: BlockId, content: string) =>
    invoke<Block>("update_block", { id, content }),
  insertBlock: (
    page: PageId,
    parent: BlockId | null,
    after: BlockId | null,
    content: string,
  ) => invoke<Block>("insert_block", { page, parent, after, content }),
  deleteBlock: (id: BlockId) => invoke<void>("delete_block", { id }),
  moveBlock: (id: BlockId, newParent: BlockId | null, newOrder: number) =>
    invoke<Block>("move_block", { id, newParent, newOrder }),

  // search
  search: (query: string, limit = 50) =>
    invoke<SearchHit[]>("search", { query, limit }),
  semanticSearch: (query: string, limit = 30) =>
    invoke<SearchHit[]>("semantic_search", { query, limit }),
  similarBlocks: (blockId: BlockId, limit = 10) =>
    invoke<SearchHit[]>("similar_blocks", { blockId, limit }),
  rebuildSearchIndex: () => invoke<void>("rebuild_search_index"),
  backlinks: (page: string) => invoke<Block[]>("backlinks", { page }),

  // query engine
  runQuery: (query: string) => invoke<Block[]>("run_query", { query }),
  parseQuery: (query: string) => invoke<QueryExpr>("parse_query", { query }),

  // journals & tasks
  todayJournal: () => invoke<Page>("today_journal"),
  listJournals: () => invoke<Page[]>("list_journals"),
  journalForDate: (ymd: number) =>
    invoke<Page>("journal_for_date", { ymd }),
  calendarSummary: (fromYmd: number, toYmd: number) =>
    invoke<CalendarCell[]>("calendar_summary", { fromYmd, toYmd }),
  blocksForDate: (ymd: number) =>
    invoke<Block[]>("blocks_for_date", { ymd }),
  cycleTask: (id: BlockId) => invoke<Block>("cycle_task", { id }),
  setTask: (id: BlockId, marker: TaskMarker | null) =>
    invoke<Block>("set_task", { id, marker }),
  openTasks: () => invoke<Block[]>("open_tasks"),
  agenda: (completedDays = 7) =>
    invoke<AgendaItem[]>("agenda", { completedDays }),

  // whiteboards
  listWhiteboards: () => invoke<WhiteboardSummary[]>("list_whiteboards"),
  getWhiteboard: (id: string) =>
    invoke<Whiteboard | null>("get_whiteboard", { id }),
  createWhiteboard: (name: string) =>
    invoke<Whiteboard>("create_whiteboard", { name }),
  saveWhiteboard: (id: string, data: unknown) =>
    invoke<Whiteboard>("save_whiteboard", { id, data }),
  deleteWhiteboard: (id: string) =>
    invoke<void>("delete_whiteboard", { id }),
  renameWhiteboard: (id: string, newName: string) =>
    invoke<Whiteboard>("rename_whiteboard", { id, newName }),

  // transfer
  exportMarkdown: (path: string) =>
    invoke<{ path: string; pages: number; blocks: number; whiteboards: number }>(
      "export_markdown",
      { path },
    ),
  exportJson: (path: string) =>
    invoke<{ path: string; pages: number; blocks: number; whiteboards: number }>(
      "export_json",
      { path },
    ),
  importMarkdown: (path: string) =>
    invoke<{ pages: number; blocks: number }>("import_markdown", { path }),
  importMarkdownFile: (name: string, content: string) =>
    invoke<{ pages: number; blocks: number }>("import_markdown_file", { name, content }),
  importJson: (path: string) =>
    invoke<{ pages: number; blocks: number }>("import_json", { path }),
  exportOpml: (path: string) =>
    invoke<{ path: string; pages: number; blocks: number; whiteboards: number }>(
      "export_opml",
      { path },
    ),
  importOpml: (path: string) =>
    invoke<{ pages: number; blocks: number }>("import_opml", { path }),
  exportPageMarkdown: (pageId: string, path: string) =>
    invoke<{ path: string; pages: number; blocks: number; whiteboards: number }>(
      "export_page_markdown",
      { pageId, path },
    ),

  // templates (module 18)
  listTemplates: () => invoke<TemplateInfo[]>("list_templates"),
  templateVariables: (id: string) =>
    invoke<string[]>("template_variables", { id }),
  insertTemplate: (
    templateId: string,
    targetPage: string,
    targetBlock: string | null,
    asChild: boolean,
    vars: Record<string, string>,
  ) =>
    invoke<Block[]>("insert_template", {
      templateId,
      targetPage,
      targetBlock,
      asChild,
      vars,
    }),

  // backlinks panel (module 24)
  backlinksGrouped: (page: string) =>
    invoke<BacklinkGroup[]>("backlinks_grouped", { page }),
  blockRefs: (id: BlockId) =>
    invoke<BacklinkGroup[]>("block_refs", { id }),
  blockContext: (id: BlockId) =>
    invoke<BlockContext | null>("block_context", { id }),

  // dashboard (module 25)
  dashboardStats: () => invoke<DashboardStats>("dashboard_stats"),

  // pdf + zotero
  importPdf: (srcPath: string) =>
    invoke<PdfAsset>("import_pdf", { srcPath }),
  listPdfs: () => invoke<PdfAsset[]>("list_pdfs"),
  readPdfBytes: (id: string) => invoke<number[]>("read_pdf_bytes", { id }),
  deletePdf: (id: string) => invoke<void>("delete_pdf", { id }),
  listPdfAnnotations: (pdfId: string) =>
    invoke<PdfAnnotation[]>("list_pdf_annotations", { pdfId }),
  savePdfAnnotations: (pdfId: string, annotations: PdfAnnotation[]) =>
    invoke<void>("save_pdf_annotations", { pdfId, annotations }),
  importZoteroBibtex: (content: string) =>
    invoke<{ pages_created: number; entries_seen: number }>(
      "import_zotero_bibtex",
      { content },
    ),

  // updater (module 14)
  appVersion: () => invoke<AppVersionInfo>("app_version"),
  checkForUpdate: () => invoke<UpdateInfo | null>("check_for_update"),
  installUpdate: () => invoke<void>("install_update"),

  // block history (module 19)
  blockHistory: (id: string, limit?: number) =>
    invoke<BlockHistoryEntry[]>("block_history", { id, limit }),
  restoreBlockVersion: (id: string, entryId: string) =>
    invoke<Block>("restore_block_version", { id, entryId }),

  // end-to-end encryption (module 20)
  encryptionStatus: () => invoke<EncryptionStatus>("encryption_status"),
  enableEncryption: (passphrase: string) =>
    invoke<EncryptionStatus>("enable_encryption", { passphrase }),
  unlockEncryption: (passphrase: string) =>
    invoke<EncryptionStatus>("unlock_encryption", { passphrase }),
  lockEncryption: () => invoke<EncryptionStatus>("lock_encryption"),
  changeEncryptionPassphrase: (oldPassphrase: string, newPassphrase: string) =>
    invoke<EncryptionStatus>("change_encryption_passphrase", {
      oldPassphrase,
      newPassphrase,
    }),
  disableEncryption: (passphrase: string) =>
    invoke<EncryptionStatus>("disable_encryption", { passphrase }),

  // comments (module 27)
  listBlockComments: (blockId: BlockId) =>
    invoke<Comment[]>("list_block_comments", { blockId }),
  listOpenComments: () => invoke<Comment[]>("list_open_comments"),
  commentCounts: (blockId: BlockId) =>
    invoke<[number, number]>("comment_counts", { blockId }),
  addComment: (
    blockId: BlockId,
    author: string,
    authorColor: string,
    body: string,
    parentId: string | null,
  ) =>
    invoke<Comment>("add_comment", {
      blockId,
      author,
      authorColor,
      body,
      parentId,
    }),
  updateComment: (id: string, body: string) =>
    invoke<Comment>("update_comment", { id, body }),
  resolveComment: (id: string, resolved: boolean) =>
    invoke<Comment>("resolve_comment", { id, resolved }),
  deleteComment: (id: string) => invoke<void>("delete_comment", { id }),

  // backup (module 28)
  listBackups: () => invoke<BackupEntry[]>("list_backups"),
  backupConfig: () => invoke<BackupConfig>("backup_config"),
  setBackupConfig: (config: BackupConfig) =>
    invoke<BackupConfig>("set_backup_config", { config }),
  createBackup: () => invoke<BackupEntry>("create_backup"),
  deleteBackup: (id: string) => invoke<void>("delete_backup", { id }),
  restoreBackup: (id: string) => invoke<string>("restore_backup", { id }),
  lastBackupAt: () => invoke<string | null>("last_backup_at"),

  // ai (module 21)
  aiConfig: () => invoke<AiConfigView>("ai_config"),
  setAiConfig: (patch: AiConfigPatch) =>
    invoke<AiConfigView>("set_ai_config", { patch }),
  aiComplete: (messages: AiMessage[]) =>
    invoke<string>("ai_complete", { messages }),
  aiCompleteStream: (messages: AiMessage[]) =>
    invoke<string>("ai_complete_stream", { messages }),
};

export interface PdfAsset {
  id: string;
  name: string;
  filename: string;
  size: number;
  added_at: string;
}

export interface PdfAnnotation {
  id: string;
  page: number;
  rects: { x: number; y: number; w: number; h: number }[];
  text: string;
  color: string;
  note: string | null;
  created_at: string;
}
