import type { ChannelConfigInput } from '@shared/rpc'
import { secretName } from '@shared/rpc'
import {
  CHANNEL_KINDS,
  type Channel,
  type ChannelKind,
  type ChannelPairing,
  type ChannelState,
  type ModelRef,
  type PermissionMode,
  type ProviderId
} from '@shared/types'
import type { AgentRunner } from '../agent-runner'
import type { HostContext } from '../context'
import type { RpcRouter } from '../rpc-router'
import type { ChatService } from '../services/chats'
import type { SettingsService } from '../services/settings'
import type { ChannelAdapter, ChannelAdapterFactory, InboundMessage } from './adapter'
import { createChatSdkAdapter } from './chat-sdk-adapter'
import { PairingCodes, parsePairingCode } from './pairing'
import { splitMessage } from './split-message'

const DEFAULT_PERMISSION_MODE: PermissionMode = 'read-only'
const NEW_CHAT_COMMAND = '/new'

const REPLIES = {
  notPaired: 'This account is not paired. Create a pairing code in Gramatrix and send it here.',
  pairInPrivate: 'This account is not paired. Send your pairing code in a direct message.',
  codeExposed:
    'That pairing code was posted where others can read it, so it has been cancelled. ' +
    'Create a new one in Gramatrix and send it in a direct message.',
  paired: 'Paired. You can now talk to Gramatrix here.',
  wrongCode: 'That code is not valid. Create a new one in Gramatrix.',
  locked: 'Too many wrong codes. Try again later.',
  noModel: 'No model is selected for this channel. Choose one in Gramatrix settings.',
  newChat: 'Started a new chat.',
  emptyResult: 'The run finished without a text reply.',
  cancelled: 'The run was cancelled because the channel settings changed.'
}

interface ChannelRow {
  kind: string
  enabled: number
  project_id: string | null
  model_provider: string | null
  model_name: string | null
  permission_mode: string
}

interface PairingRow {
  kind: string
  external_user_id: string
  display_name: string
  paired_at: number
}

interface Connection {
  state: ChannelState
  error: string | null
}

export interface ChannelServiceDependencies {
  chats: ChatService
  settings: SettingsService
  runner: AgentRunner
  /** Defaults to the real platform connections. */
  createAdapter?: ChannelAdapterFactory
}

/** Connects chat platforms to agent runs. Only paired senders ever reach the agent. */
export class ChannelService {
  private readonly chats: ChatService
  private readonly settings: SettingsService
  private readonly runner: AgentRunner
  private readonly createAdapter: ChannelAdapterFactory
  private readonly pairing: PairingCodes
  private readonly adapters = new Map<ChannelKind, ChannelAdapter>()
  private readonly connections = new Map<ChannelKind, Connection>()
  private readonly threadQueues = new Map<string, Promise<void>>()
  /** Cancels the active runs of a channel. Replaced after each use. */
  private readonly runControllers = new Map<ChannelKind, AbortController>()
  private stopped = false
  /** Connects and disconnects run one at a time so a quick toggle cannot leak a connection. */
  private lifecycle: Promise<void> = Promise.resolve()

  constructor(
    private readonly context: HostContext,
    dependencies: ChannelServiceDependencies
  ) {
    this.chats = dependencies.chats
    this.settings = dependencies.settings
    this.runner = dependencies.runner
    this.createAdapter = dependencies.createAdapter ?? createChatSdkAdapter
    this.pairing = new PairingCodes(context.now)
  }

  list(): Channel[] {
    return CHANNEL_KINDS.map((kind) => this.get(kind))
  }

  configure(input: ChannelConfigInput): Channel {
    this.context.db
      .prepare(
        `INSERT INTO channels (kind, enabled, project_id, model_provider, model_name, permission_mode)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(kind) DO UPDATE SET enabled = excluded.enabled,
           project_id = excluded.project_id, model_provider = excluded.model_provider,
           model_name = excluded.model_name, permission_mode = excluded.permission_mode`
      )
      .run(
        input.kind,
        input.enabled ? 1 : 0,
        input.projectId,
        input.model?.provider ?? null,
        input.model?.model ?? null,
        input.permissionMode
      )
    // Runs started under the old settings must not outlive them.
    this.abortRuns(input.kind)
    // Always reconnects, so saving a new token takes effect right away.
    this.enqueueReconnect(input.kind)
    return this.get(input.kind)
  }

  createPairingCode(kind: ChannelKind): string {
    return this.pairing.create(kind)
  }

  pairings(kind: ChannelKind): ChannelPairing[] {
    const rows = this.context.db
      .prepare('SELECT * FROM channel_pairings WHERE kind = ? ORDER BY paired_at')
      .all(kind) as unknown as PairingRow[]
    return rows.map((row) => ({
      kind: row.kind as ChannelKind,
      externalUserId: row.external_user_id,
      displayName: row.display_name,
      pairedAt: row.paired_at
    }))
  }

  revokePairing(kind: ChannelKind, externalUserId: string): void {
    this.context.db
      .prepare('DELETE FROM channel_pairings WHERE kind = ? AND external_user_id = ?')
      .run(kind, externalUserId)
  }

  start(): void {
    for (const channel of this.list()) {
      if (channel.enabled) this.enqueueReconnect(channel.kind)
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    for (const kind of CHANNEL_KINDS) {
      this.abortRuns(kind)
      this.enqueue(() => this.disconnect(kind))
    }
    await this.settled()
  }

  /** Resolves once connection changes and queued messages have been handled. */
  async settled(): Promise<void> {
    await this.lifecycle
    await Promise.all(this.threadQueues.values())
  }

  register(router: RpcRouter): void {
    router.handle('channels.list', () => this.list())
    router.handle('channels.configure', (input) => this.configure(input))
    router.handle('channels.createPairingCode', ({ kind }) => ({
      code: this.createPairingCode(kind)
    }))
    router.handle('channels.pairings', ({ kind }) => this.pairings(kind))
    router.handle('channels.revokePairing', ({ kind, externalUserId }) =>
      this.revokePairing(kind, externalUserId)
    )
  }

  private get(kind: ChannelKind): Channel {
    const row = this.context.db.prepare('SELECT * FROM channels WHERE kind = ?').get(kind) as
      ChannelRow | undefined
    const connection = this.connections.get(kind) ?? { state: 'disabled', error: null }
    return {
      kind,
      enabled: row?.enabled === 1,
      projectId: row?.project_id ?? null,
      model:
        row?.model_provider && row.model_name
          ? { provider: row.model_provider as ProviderId, model: row.model_name }
          : null,
      permissionMode: (row?.permission_mode as PermissionMode) ?? DEFAULT_PERMISSION_MODE,
      state: connection.state,
      error: connection.error
    }
  }

  private abortRuns(kind: ChannelKind): void {
    this.runControllers.get(kind)?.abort()
    this.runControllers.delete(kind)
  }

  private runSignal(kind: ChannelKind): AbortSignal {
    let controller = this.runControllers.get(kind)
    if (!controller) {
      controller = new AbortController()
      this.runControllers.set(kind, controller)
    }
    return controller.signal
  }

  private isActive(kind: ChannelKind): boolean {
    return !this.stopped && this.get(kind).enabled
  }

  private enqueue(step: () => Promise<void>): void {
    this.lifecycle = this.lifecycle.then(step, step)
  }

  private enqueueReconnect(kind: ChannelKind): void {
    this.enqueue(async () => {
      await this.disconnect(kind)
      if (this.get(kind).enabled) await this.connect(kind)
    })
  }

  private async connect(kind: ChannelKind): Promise<void> {
    this.setConnection(kind, 'connecting', null)
    try {
      const adapter = await this.createAdapter(kind, (field) =>
        this.context.getSecret(secretName.channel(kind, field))
      )
      await adapter.start((message) => this.receive(kind, adapter, message))
      this.adapters.set(kind, adapter)
      this.setConnection(kind, 'connected', null)
    } catch (error) {
      this.setConnection(kind, 'error', error instanceof Error ? error.message : String(error))
    }
  }

  private async disconnect(kind: ChannelKind): Promise<void> {
    const adapter = this.adapters.get(kind)
    this.adapters.delete(kind)
    try {
      await adapter?.stop()
    } finally {
      this.setConnection(kind, 'disabled', null)
    }
  }

  private setConnection(kind: ChannelKind, state: ChannelState, error: string | null): void {
    this.connections.set(kind, { state, error })
    this.context.emit('channels.changed', this.list())
  }

  /** Messages in one thread are handled in order. Different threads do not wait for each other. */
  private receive(kind: ChannelKind, adapter: ChannelAdapter, message: InboundMessage): void {
    if (message.isBot) return
    const key = `${kind}:${message.threadId}`
    const previous = this.threadQueues.get(key) ?? Promise.resolve()
    const next = previous
      .then(() => this.handle(kind, adapter, message))
      // A failed reply must not stop later messages in the thread.
      .catch((error: unknown) => console.warn(`Channel ${kind} failed to reply:`, error))
      .finally(() => {
        if (this.threadQueues.get(key) === next) this.threadQueues.delete(key)
      })
    this.threadQueues.set(key, next)
  }

  private async handle(
    kind: ChannelKind,
    adapter: ChannelAdapter,
    message: InboundMessage
  ): Promise<void> {
    // First, because anyone can post a code, including a paired account or a locked out one.
    if (!message.isDirect && this.pairing.burnIfExposed(kind, message.text)) {
      await message.reply(REPLIES.codeExposed)
      return
    }
    // A message can wait in the queue behind a long run, so the channel may be off by now.
    if (!this.isActive(kind)) return

    if (!this.isPaired(kind, message.userId)) {
      await this.handleUnpaired(kind, message)
      return
    }

    const text = message.text.trim()
    if (!text) return

    const channel = this.get(kind)
    const model = channel.model ?? this.settings.get().defaultModel
    if (!model) {
      await message.reply(REPLIES.noModel)
      return
    }

    if (text === NEW_CHAT_COMMAND) {
      this.unlinkThread(kind, message.threadId)
      await message.reply(REPLIES.newChat)
      return
    }

    const chatId = this.resolveChat(kind, message, channel.projectId, model, channel.permissionMode)
    const signal = this.runSignal(kind)
    let reply: string
    try {
      const result = await this.runner.runHeadless({
        chatId,
        text,
        permissionMode: channel.permissionMode,
        source: 'channel',
        signal
      })
      reply = result.text.trim() || REPLIES.emptyResult
    } catch (error) {
      reply = `The run failed: ${error instanceof Error ? error.message : String(error)}`
    }
    if (signal.aborted) {
      if (this.isActive(kind)) await message.reply(REPLIES.cancelled)
      return
    }
    for (const piece of splitMessage(reply, adapter.maxMessageLength)) {
      await message.reply(piece)
    }
  }

  private async handleUnpaired(kind: ChannelKind, message: InboundMessage): Promise<void> {
    // No reply during a lockout, so a flood of messages cannot make the bot flood back.
    if (this.pairing.isLocked(kind, message.userId)) return

    const code = parsePairingCode(message.text)
    if (!code) {
      await message.reply(message.isDirect ? REPLIES.notPaired : REPLIES.pairInPrivate)
      return
    }
    if (!message.isDirect) {
      await message.reply(REPLIES.pairInPrivate)
      return
    }
    const result = this.pairing.redeem(kind, message.userId, code)
    if (result === 'paired') {
      this.savePairing(kind, message)
      await message.reply(REPLIES.paired)
    } else {
      await message.reply(result === 'locked' ? REPLIES.locked : REPLIES.wrongCode)
    }
  }

  private isPaired(kind: ChannelKind, userId: string): boolean {
    const row = this.context.db
      .prepare('SELECT 1 FROM channel_pairings WHERE kind = ? AND external_user_id = ?')
      .get(kind, userId)
    return row !== undefined
  }

  private savePairing(kind: ChannelKind, message: InboundMessage): void {
    this.context.db
      .prepare(
        `INSERT OR REPLACE INTO channel_pairings (kind, external_user_id, display_name, paired_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(kind, message.userId, message.displayName, this.context.now())
  }

  private unlinkThread(kind: ChannelKind, threadId: string): void {
    this.context.db
      .prepare('DELETE FROM channel_chats WHERE kind = ? AND external_thread_id = ?')
      .run(kind, threadId)
  }

  /**
   * Reuses the chat linked to the thread unless the channel moved to another project.
   * A channel without a project creates general chats, which have no tools.
   */
  private resolveChat(
    kind: ChannelKind,
    message: InboundMessage,
    projectId: string | null,
    model: ModelRef,
    permissionMode: PermissionMode
  ): string {
    const row = this.context.db
      .prepare('SELECT chat_id FROM channel_chats WHERE kind = ? AND external_thread_id = ?')
      .get(kind, message.threadId) as { chat_id: string } | undefined
    if (row) {
      const chat = this.chats.get(row.chat_id)
      if (chat.projectId === projectId) {
        this.chats.update(chat.id, { model, permissionMode })
        return chat.id
      }
      this.unlinkThread(kind, message.threadId)
    }
    const chat = this.chats.create({
      projectId,
      model,
      permissionMode,
      title: `${kind === 'telegram' ? 'Telegram' : 'Slack'}: ${message.displayName}`
    })
    this.context.db
      .prepare('INSERT INTO channel_chats (kind, external_thread_id, chat_id) VALUES (?, ?, ?)')
      .run(kind, message.threadId, chat.id)
    return chat.id
  }
}
