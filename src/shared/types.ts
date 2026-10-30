// Domain types shared by the main process, the host process and the renderer.

export const PROVIDER_IDS = [
  'anthropic',
  'openai',
  'openrouter',
  'zai',
  'minimax',
  'zai-coding-plan',
  'zhipu-coding-plan',
  'minimax-coding-plan',
  'kimi-coding-plan',
  'alibaba-coding-plan'
] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]

/** `api` bills per token. `plan` is a subscription whose keys only work on their own endpoint. */
export type ProviderKind = 'api' | 'plan'

export interface ProviderInfo {
  id: ProviderId
  label: string
  kind: ProviderKind
  /** Logo file name in the renderer assets, without the extension. */
  logo: string
  /** One line telling people which key belongs here. */
  hint: string
  /** Page where a user can create an API key. */
  keyUrl: string
  defaultModel: string
}

export interface ModelInfo {
  id: string
  name: string
  /** Maximum context in tokens, when known. */
  contextWindow: number | null
  /** US dollars per million tokens, when known. Plans have no per token price. */
  inputPrice: number | null
  outputPrice: number | null
  /** US dollars per million cached input tokens, when known. */
  cachedInputPrice?: number | null
  supportsTools: boolean
  supportsReasoning: boolean
}

/** Where a model list came from. `live` is the provider itself, the others are fallbacks. */
export type ModelListSource = 'live' | 'catalog' | 'snapshot'

export interface ModelList {
  models: ModelInfo[]
  source: ModelListSource
}

export interface ProviderStatus extends ProviderInfo {
  configured: boolean
}

export interface ModelRef {
  provider: ProviderId
  model: string
}

export interface Project {
  id: string
  name: string
  path: string
  createdAt: number
  lastOpenedAt: number
}

/**
 * How much a run may do without asking.
 * `ask` prompts for writes and commands. Runs with nobody to answer treat a prompt as a denial.
 */
export const PERMISSION_MODES = ['read-only', 'ask', 'accept-edits', 'full-access'] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

export interface Chat {
  id: string
  /** Null for a general chat, which has no folder and therefore no file or command tools. */
  projectId: string | null
  title: string
  model: ModelRef
  permissionMode: PermissionMode
  createdAt: number
  updatedAt: number
}

export type ToolCallState = 'running' | 'awaiting-approval' | 'completed' | 'failed' | 'denied'

export interface TextPart {
  type: 'text'
  text: string
}

export interface ReasoningPart {
  type: 'reasoning'
  text: string
}

export interface ToolCallPart {
  type: 'tool-call'
  toolCallId: string
  toolName: string
  input: unknown
  output?: unknown
  state: ToolCallState
  /** Set when the call ran inside a subagent. */
  subagentId?: string
}

export type MessagePart = TextPart | ReasoningPart | ToolCallPart

export type MessageRole = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  chatId: string
  role: MessageRole
  parts: MessagePart[]
  createdAt: number
}

export interface ApprovalRequest {
  id: string
  chatId: string
  toolCallId: string
  toolName: string
  /** Short human readable description of the action. */
  summary: string
  input: unknown
}

/** Live progress of one agent run. Persisted state is read back through `chats.messages`. */
export type RunEvent =
  | { type: 'started'; runId: string; chatId: string; messageId: string }
  | { type: 'text-delta'; runId: string; chatId: string; delta: string }
  | { type: 'reasoning-delta'; runId: string; chatId: string; delta: string }
  | { type: 'tool-call'; runId: string; chatId: string; part: ToolCallPart }
  | { type: 'tool-update'; runId: string; chatId: string; part: ToolCallPart }
  | {
      type: 'subagent'
      runId: string
      chatId: string
      subagentId: string
      name: string
      status: 'started' | 'completed' | 'failed'
    }
  | { type: 'approval-requested'; runId: string; chatId: string; request: ApprovalRequest }
  | { type: 'approval-resolved'; runId: string; chatId: string; requestId: string }
  | { type: 'finished'; runId: string; chatId: string }
  | { type: 'cancelled'; runId: string; chatId: string }
  | { type: 'failed'; runId: string; chatId: string; error: string }

export interface Job {
  id: string
  projectId: string
  name: string
  /** Five field cron expression evaluated in the local time zone. */
  cron: string
  prompt: string
  model: ModelRef
  /** Jobs run unattended, so `ask` behaves like `read-only` for anything that needs approval. */
  permissionMode: PermissionMode
  enabled: boolean
  /** Run once on startup if a scheduled time passed while the app was closed. */
  catchUp: boolean
  lastRunAt: number | null
  nextRunAt: number | null
  createdAt: number
}

export type JobRunStatus = 'running' | 'succeeded' | 'failed' | 'missed'

export interface JobRun {
  id: string
  jobId: string
  /** Chat holding the transcript of the run. Null for missed runs. */
  chatId: string | null
  status: JobRunStatus
  startedAt: number
  finishedAt: number | null
  error: string | null
}

export const CHANNEL_KINDS = ['telegram', 'slack'] as const
export type ChannelKind = (typeof CHANNEL_KINDS)[number]

export type ChannelState = 'disabled' | 'connecting' | 'connected' | 'error'

export interface Channel {
  kind: ChannelKind
  enabled: boolean
  /** Project that messages from this channel work in. Null means plain conversation. */
  projectId: string | null
  model: ModelRef | null
  permissionMode: PermissionMode
  state: ChannelState
  error: string | null
}

export interface ChannelPairing {
  kind: ChannelKind
  externalUserId: string
  displayName: string
  pairedAt: number
}

export const THEME_IDS = [
  'matrix',
  'dracula',
  'vscode-dark',
  'vscode-light',
  'catppuccin-mocha',
  'catppuccin-macchiato',
  'catppuccin-frappe',
  'catppuccin-latte',
  'tokyo-night',
  'nord',
  'one-dark',
  'github-dark',
  'github-light',
  'gruvbox-dark',
  'gruvbox-light',
  'solarized-dark',
  'solarized-light',
  'rose-pine',
  'monokai',
  'ayu-dark',
  'kanagawa',
  'everforest'
] as const
export type ThemeId = (typeof THEME_IDS)[number]

/** Syntax theme for code blocks. `auto` follows the app theme. */
export const CODE_THEME_IDS = ['auto', ...THEME_IDS] as const
export type CodeThemeId = (typeof CODE_THEME_IDS)[number]

export interface CodeSettings {
  theme: CodeThemeId
  lineNumbers: boolean
  wrapLines: boolean
  ligatures: boolean
  /** Pixels. */
  fontSize: number
}

export interface BackgroundVideoSettings {
  enabled: boolean
  /** File name inside the app data backgrounds folder. Null plays the bundled video. */
  customFile: string | null
  /** Percent. */
  opacity: number
  /** Pixels. */
  blur: number
}

export interface AppSettings {
  onboardingCompleted: boolean
  theme: ThemeId
  uiFont: string
  monoFont: string
  fontSize: number
  code: CodeSettings
  /** Overrides the theme accent. Null keeps the color the theme defines. */
  accentColor: string | null
  /** Percent. Below 100 the desktop shows through the window background. */
  windowOpacity: number
  backgroundVideo: BackgroundVideoSettings
  reduceMotion: boolean
  /** Keep running in the tray after the window closes so jobs and channels stay active. */
  closeToTray: boolean
  defaultModel: ModelRef | null
  /** Most recently used first, shown at the top of the model picker. */
  recentModels: ModelRef[]
  favoriteModels: ModelRef[]
  defaultPermissionMode: PermissionMode
}

export const DEFAULT_SETTINGS: AppSettings = {
  onboardingCompleted: false,
  theme: 'matrix',
  uiFont: "'Inter Variable', system-ui, sans-serif",
  monoFont: "'JetBrains Mono Variable', ui-monospace, monospace",
  fontSize: 14,
  code: { theme: 'auto', lineNumbers: false, wrapLines: false, ligatures: true, fontSize: 13 },
  accentColor: null,
  windowOpacity: 100,
  backgroundVideo: { enabled: true, customFile: null, opacity: 35, blur: 0 },
  reduceMotion: false,
  closeToTray: true,
  defaultModel: null,
  recentModels: [],
  favoriteModels: [],
  defaultPermissionMode: 'ask'
}

/** What caused a model call. */
export type UsageSource = 'chat' | 'job' | 'channel' | 'subagent'

export interface UsageTotals {
  runs: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  reasoningTokens: number
  /** US dollars across calls with a known price. */
  cost: number
  /** Calls with no known price, such as subscription plans. */
  unpricedRuns: number
}

export interface UsageRow extends UsageTotals {
  key: string
  label: string
}

export interface UsageQuery {
  /** Epoch milliseconds, inclusive. */
  from?: number
  /** Epoch milliseconds, exclusive. */
  to?: number
  chatId?: string
  /** Null selects general chats. */
  projectId?: string | null
}

export interface UsageReport {
  totals: UsageTotals
  /** Local calendar days, oldest first, keyed YYYY-MM-DD. Days with no use are present as zero. */
  byDay: UsageRow[]
  byProvider: UsageRow[]
  byModel: UsageRow[]
  byProject: UsageRow[]
  bySource: UsageRow[]
}

/**
 * `keychain` means secrets are protected by the operating system.
 * `weak` means no secret service was found on Linux and encryption gives no real protection.
 */
export type SecretBackend = 'keychain' | 'weak' | 'unavailable'

/** `unknown` means it depends on a compositor that cannot be detected, as on Linux with X11. */
export type TransparencySupport = 'supported' | 'unknown'

export interface AppInfo {
  version: string
  platform: string
  secretBackend: SecretBackend
  transparency: TransparencySupport
}
