// Generated-style type definitions mirroring the Rust model.

export type BlockId = string;
export type PageId = string;

export type StorageKind = "markdown" | "sqlite";

export interface GraphMeta {
  name: string;
  root: string;
  kind: StorageKind;
  opened_at: string;
}

export interface Page {
  id: PageId;
  name: string;
  journal_day: number | null;
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  root_block_ids: BlockId[];
}

export type TaskMarker =
  | "TODO"
  | "DOING"
  | "DONE"
  | "LATER"
  | "NOW"
  | "WAITING"
  | "CANCELLED";

export interface Block {
  id: BlockId;
  page_id: PageId;
  parent_id: BlockId | null;
  order: number;
  content: string;
  properties: Record<string, unknown>;
  refs_pages: string[];
  refs_blocks: BlockId[];
  tags: string[];
  children: BlockId[];
  task_marker: TaskMarker | null;
  scheduled: string | null;
  deadline: string | null;
  created_at: string;
  updated_at: string;
}

export interface SearchHit {
  page: string;
  block_id: BlockId;
  snippet: string;
}

export type QueryExpr =
  | { kind: "page_ref"; name: string }
  | { kind: "tag"; tag: string }
  | { kind: "block_ref"; id: string }
  | { kind: "contains"; words: string[] }
  | { kind: "task"; markers: string[] }
  | { kind: "and"; children: QueryExpr[] }
  | { kind: "or"; children: QueryExpr[] }
  | { kind: "not"; child: QueryExpr };

export interface Whiteboard {
  id: string;
  name: string;
  data: unknown;
  created_at: string;
  updated_at: string;
}

export interface WhiteboardSummary {
  id: string;
  name: string;
  updated_at: string;
}

export interface GraphNode {
  id: string;
  name: string;
  weight: number;
  is_journal: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface GraphStats {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface CalendarCell {
  ymd: number;
  journal: boolean;
  scheduled: number;
  deadline: number;
  completed: number;
}

export interface AgendaItem {
  block: Block;
  page_name: string;
  kind: "scheduled" | "deadline" | "none";
  iso_date: string | null;
  closed: boolean;
}

export interface UpdateInfo {
  version: string;
  current_version: string;
  notes: string | null;
  date: string | null;
}

export interface AppVersionInfo {
  version: string;
  tauri_version: string;
  identifier: string;
}

export interface BlockHistoryEntry {
  id: string;
  block_id: string;
  content: string;
  edited_at: string;
  recorded_at: string;
}

export interface EncryptionMeta {
  version: number;
  algorithm: string;
  kdf: string;
  salt: string;
  m_cost: number;
  t_cost: number;
  p_cost: number;
  verifier: string;
  created_at: string;
}

export interface EncryptionStatus {
  enabled: boolean;
  unlocked: boolean;
  meta: EncryptionMeta | null;
}

export interface Comment {
  id: string;
  block_id: BlockId;
  author: string;
  author_color: string;
  body: string;
  created_at: string;
  updated_at: string;
  resolved: boolean;
  parent_id: string | null;
}

export interface BackupConfig {
  enabled: boolean;
  interval_mins: number;
  max_keep: number;
}

export type BackupKind = "manual" | "auto";

export interface BackupEntry {
  id: string;
  filename: string;
  size: number;
  created_at: string;
  kind: BackupKind;
}

// --- Text AI assistant (module 21) --------------------------------------

export type AiRole = "system" | "user" | "assistant";

export interface AiMessage {
  role: AiRole;
  content: string;
}

export interface AiConfigView {
  enabled: boolean;
  endpoint: string;
  has_api_key: boolean;
  model: string;
  temperature: number;
  max_tokens: number;
  system_prompt: string;
}

export interface AiConfigPatch {
  enabled?: boolean;
  endpoint?: string;
  api_key?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  system_prompt?: string;
}

export interface TemplateInfo {
  id: string;
  name: string;
  page_id: string;
  page_name: string;
  variables: string[];
  preview: string;
}

// --- Backlinks panel (module 24) ----------------------------------------

export interface BacklinkHit {
  block: Block;
  ancestors: Block[];
}

export interface BacklinkGroup {
  page_id: string;
  page_name: string;
  is_journal: boolean;
  hits: BacklinkHit[];
}

export interface BlockContext {
  block: Block;
  page: Page | null;
  ancestors: Block[];
  children: Block[];
}

// --- Dashboard (module 25) -----------------------------------------------

export interface TaskFunnel {
  todo: number;
  doing: number;
  done: number;
  later: number;
  now: number;
  waiting: number;
  cancelled: number;
}

export interface DailyPoint {
  date: string;
  blocks_created: number;
  tasks_completed: number;
}

export interface HotPage {
  id: string;
  name: string;
  inbound: number;
  is_journal: boolean;
}

export interface HotTag {
  tag: string;
  count: number;
}

export interface OverallStats {
  pages: number;
  journal_pages: number;
  blocks: number;
  tasks_open: number;
  tasks_done: number;
  tags_total: number;
  refs_total: number;
}

export interface DashboardStats {
  overall: OverallStats;
  task_funnel: TaskFunnel;
  daily: DailyPoint[];
  hot_pages: HotPage[];
  hot_tags: HotTag[];
  upcoming_deadlines: number;
  upcoming_scheduled: number;
}
