import type {
  AppInfo,
  AppSettings,
  ApprovalRequest,
  Channel,
  ChannelKind,
  ChannelPairing,
  Chat,
  ChatMessage,
  Job,
  JobRun,
  ModelList,
  ModelRef,
  PermissionMode,
  Project,
  ProviderId,
  ProviderStatus,
  RunEvent,
  UsageQuery,
  UsageReport
} from './types'

export interface ProviderTestResult {
  ok: boolean
  /** Plain explanation with what to do next. */
  error?: string
  /** The raw facts, shown so a failure can be diagnosed or reported. */
  details?: { endpoint: string; model: string; status?: number; code?: string; message?: string }
}

export type JobInput = Pick<
  Job,
  'projectId' | 'name' | 'cron' | 'prompt' | 'model' | 'permissionMode' | 'enabled' | 'catchUp'
>

export interface ChannelConfigInput {
  kind: ChannelKind
  enabled: boolean
  projectId: string | null
  model: ModelRef | null
  permissionMode: PermissionMode
}

/**
 * Every request the renderer can make. Methods in `MAIN_METHODS` are handled by the
 * main process. All others are forwarded to the host process.
 */
export interface RpcMethods {
  'app.info': { params: void; result: AppInfo }
  'app.pickDirectory': { params: void; result: string | null }
  'app.openExternal': { params: { url: string }; result: void }
  /** Copies a video the user picks into app data. Returns its file name, null when cancelled. */
  'app.pickBackgroundVideo': { params: void; result: string | null }

  'secrets.set': { params: { name: string; value: string }; result: void }
  'secrets.delete': { params: { name: string }; result: void }
  'secrets.has': { params: { name: string }; result: boolean }

  /** Whether an opencode install on this machine has a key for this provider. */
  'opencode.hasKey': { params: { provider: ProviderId }; result: boolean }
  /** Verifies the opencode key and saves it. The value never reaches the renderer. */
  'opencode.importKey': { params: { provider: ProviderId }; result: ProviderTestResult }

  'settings.get': { params: void; result: AppSettings }
  'settings.update': { params: Partial<AppSettings>; result: AppSettings }

  'providers.list': { params: void; result: ProviderStatus[] }
  /** Lists models, live from the provider when possible. Results are cached by the host. */
  'providers.models': { params: { provider: ProviderId; refresh?: boolean }; result: ModelList }
  'providers.test': {
    /** `key` tries a key before it is saved. Without it the stored key is used. */
    params: { provider: ProviderId; model?: string; key?: string }
    result: ProviderTestResult
  }

  'projects.list': { params: void; result: Project[] }
  'projects.add': { params: { path: string }; result: Project }
  'projects.remove': { params: { id: string }; result: void }
  'projects.touch': { params: { id: string }; result: Project }

  /** Every chat, newest first. The interface groups them by project. */
  'chats.list': { params: void; result: Chat[] }
  'chats.create': {
    params: { projectId: string | null; model: ModelRef; permissionMode?: PermissionMode }
    result: Chat
  }
  'chats.update': {
    params: { id: string; title?: string; model?: ModelRef; permissionMode?: PermissionMode }
    result: Chat
  }
  'chats.remove': { params: { id: string }; result: void }
  'chats.messages': { params: { chatId: string }; result: ChatMessage[] }

  'agent.send': { params: { chatId: string; text: string }; result: { runId: string } }
  /** Runs the last user message again, replacing any answer that followed it. */
  'agent.retry': { params: { chatId: string }; result: { runId: string } }
  'agent.cancel': { params: { chatId: string }; result: void }
  'agent.resolveApproval': { params: { requestId: string; approved: boolean }; result: void }
  'agent.pendingApprovals': { params: { chatId: string }; result: ApprovalRequest[] }

  'jobs.list': { params: void; result: Job[] }
  'jobs.create': { params: JobInput; result: Job }
  'jobs.update': { params: { id: string; patch: Partial<JobInput> }; result: Job }
  'jobs.remove': { params: { id: string }; result: void }
  'jobs.runNow': { params: { id: string }; result: void }
  'jobs.runs': { params: { jobId: string }; result: JobRun[] }

  'usage.report': { params: UsageQuery; result: UsageReport }

  'channels.list': { params: void; result: Channel[] }
  'channels.configure': { params: ChannelConfigInput; result: Channel }
  'channels.createPairingCode': { params: { kind: ChannelKind }; result: { code: string } }
  'channels.pairings': { params: { kind: ChannelKind }; result: ChannelPairing[] }
  'channels.revokePairing': {
    params: { kind: ChannelKind; externalUserId: string }
    result: void
  }
}

export type RpcMethod = keyof RpcMethods
export type RpcParams<M extends RpcMethod> = RpcMethods[M]['params']
export type RpcResult<M extends RpcMethod> = RpcMethods[M]['result']

/** Handled by the main process because they need Electron APIs. */
export const MAIN_METHODS = [
  'app.info',
  'app.pickDirectory',
  'app.openExternal',
  'app.pickBackgroundVideo',
  'secrets.set',
  'secrets.delete',
  'secrets.has',
  'opencode.hasKey',
  'opencode.importKey'
] as const satisfies readonly RpcMethod[]

export type MainMethod = (typeof MAIN_METHODS)[number]

export function isMainMethod(method: string): method is MainMethod {
  return (MAIN_METHODS as readonly string[]).includes(method)
}

/** Every push notification from the host process to the renderer. */
export interface HostEvents {
  'run.event': RunEvent
  'chats.changed': { projectId: string | null }
  'jobs.changed': { projectId: string }
  'channels.changed': Channel[]
  'settings.changed': AppSettings
  'usage.changed': { chatId: string | null; projectId: string | null }
  /** Sent by the main process when the window is hidden, minimized or shown again. */
  'window.visibility': { visible: boolean }
}

export type HostEventName = keyof HostEvents

/** Renderer API exposed by the preload script as `window.gramatrix`. */
export interface GramatrixApi {
  invoke<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>>
  on<E extends HostEventName>(event: E, listener: (payload: HostEvents[E]) => void): () => void
}

/** Secret names. The renderer can write these but can never read a value back. */
export const secretName = {
  provider: (provider: ProviderId) => `provider:${provider}`,
  channel: (kind: ChannelKind, field: string) => `channel:${kind}:${field}`
}

/** Wire messages between the main process and the host process. */
export type HostInbound =
  | { kind: 'request'; id: number; method: string; params: unknown }
  | { kind: 'secret-response'; id: number; value: string | null }
  | { kind: 'shutdown' }

export type HostOutbound =
  | { kind: 'ready' }
  | { kind: 'response'; id: number; ok: true; result: unknown }
  | { kind: 'response'; id: number; ok: false; error: string }
  | { kind: 'event'; event: HostEventName; payload: unknown }
  | { kind: 'secret-request'; id: number; name: string }
  | { kind: 'shutdown-complete' }
