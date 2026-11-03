import type { ChannelConfigInput, PairingCode } from '@shared/rpc'
import { secretName } from '@shared/rpc'
import {
  CHANNEL_KINDS,
  type Channel,
  type ChannelKind,
  type ChannelPairing,
  type ChannelState,
  type ModelRef,
  PERMISSION_MODES,
  type PermissionMode,
  type ProviderId
} from '@shared/types'
import type { AgentRunner } from '../agent-runner'
import type { BotService } from '../bots/bot-service'
import type { HostContext } from '../context'
import type { ProviderService } from '../providers/provider-service'
import type { RpcRouter } from '../rpc-router'
import type { ChatService } from '../services/chats'
import type { ProjectService } from '../services/projects'
import type { SettingsService } from '../services/settings'
import type { ChannelAdapter, ChannelAdapterFactory, InboundMessage } from './adapter'
import { createChatSdkAdapter } from './chat-sdk-adapter'
import {
  CHANNEL_COMMANDS,
  helpReply,
  parseCommand,
  pick,
  sameModel,
  statusReply,
  type CommandContext,
  type CommandReply,
  type ParsedCommand,
  type ThreadSettings
} from './commands'
import { PairingCodes, parsePairingCode } from './pairing'
import { splitMessage } from './split-message'
import { ThreadChoiceStore } from './thread-choices'

const DEFAULT_PERMISSION_MODE: PermissionMode = 'read-only'

/** Where the owner finds the pairing link, written for someone reading it in a chat app. */
const HOW_TO_PAIR: Record<ChannelKind, string> = {
  telegram:
    'To use it, open Gramatrix on the computer this bot belongs to, go to Channels, Telegram, ' +
    'and choose Pair. Then open the link it shows, or send the code here.',
  slack:
    'To use it, open Gramatrix on the computer this bot belongs to, go to Channels, Slack, and ' +
    'choose Pair. Then send the code it shows here.'
}

const REPLIES = {
  notPaired: (kind: ChannelKind) =>
    `This account is not paired with Gramatrix yet. ${HOW_TO_PAIR[kind]}`,
  welcome: (kind: ChannelKind) => `Hi! This bot answers through Gramatrix. ${HOW_TO_PAIR[kind]}`,
  ready: 'You are paired. Send a message to talk to your agent, or /help to see what else works.',
  alreadyPaired: 'This account is already paired. Send a message to talk to your agent.',
  pairInPrivate: 'Pairing only works in a direct message with the bot. Send your code there.',
  codeExposed:
    'That pairing code was posted where others can read it, so it has been cancelled. ' +
    'Create a new one in Gramatrix and send it in a direct message.',
  paired:
    'Paired. You can now talk to Gramatrix here. Send /help to see the commands, such as /new ' +
    'for a new chat or /model to change the model.',
  wrongCode:
    'That code is not valid. Codes work once, for 10 minutes, and restarting Gramatrix cancels ' +
    'them. Create a new one in Gramatrix.',
  locked: 'Too many wrong codes. Try again later.',
  noModel: 'No model is selected for this channel. Choose one in Gramatrix settings.',
  newChat: 'Started a new chat.',
  emptyResult: 'The run finished without a text reply.',
  cancelled: 'The run was cancelled because the channel settings changed.',
  stopped: 'Stopped.',
  nothingRunning: 'Nothing is running right now.'
}

/** Sent by Telegram when someone opens the bot, with a code when they came from a pairing link. */
const START_COMMAND = '/start'

interface ChannelRow {
  kind: string
  enabled: number
  project_id: string | null
  model_provider: string | null
  model_name: string | null
  permission_mode: string
  bot_id: string | null
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
  account?: string | null
}

export interface ChannelServiceDependencies {
  chats: ChatService
  settings: SettingsService
  projects: ProjectService
  bots: BotService
  /** Tells which providers have a key, for the models chat commands offer. */
  providers: Pick<ProviderService, 'list'>
  runner: AgentRunner
  /** Defaults to the real platform connections. */
  createAdapter?: ChannelAdapterFactory
}

/** Connects chat platforms to agent runs. Only paired senders ever reach the agent. */
export class ChannelService {
  private readonly chats: ChatService
  private readonly settings: SettingsService
  private readonly projects: ProjectService
  private readonly bots: BotService
  private readonly providers: Pick<ProviderService, 'list'>
  private readonly runner: AgentRunner
  private readonly createAdapter: ChannelAdapterFactory
  private readonly pairing: PairingCodes
  private readonly choices: ThreadChoiceStore
  private readonly adapters = new Map<ChannelKind, ChannelAdapter>()
  private readonly connections = new Map<ChannelKind, Connection>()
  private readonly threadQueues = new Map<string, Promise<void>>()
  /** Commands answered at once, outside the thread queues. */
  private readonly immediate = new Set<Promise<void>>()
  /** Stops the answer running in a thread. */
  private readonly threadRuns = new Map<string, AbortController>()
  /** Goes up on /stop. Messages queued before that are dropped. */
  private readonly threadEpochs = new Map<string, number>()
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
    this.projects = dependencies.projects
    this.bots = dependencies.bots
    this.providers = dependencies.providers
    this.runner = dependencies.runner
    this.createAdapter = dependencies.createAdapter ?? createChatSdkAdapter
    this.pairing = new PairingCodes(context.now)
    this.choices = new ThreadChoiceStore(context)
  }

  list(): Channel[] {
    return CHANNEL_KINDS.map((kind) => this.get(kind))
  }

  configure(input: ChannelConfigInput): Channel {
    const botId = this.existingBot(input.botId ?? null)
    const before = this.get(input.kind)
    this.context.db
      .prepare(
        `INSERT INTO channels
         (kind, enabled, project_id, model_provider, model_name, permission_mode, bot_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(kind) DO UPDATE SET enabled = excluded.enabled,
           project_id = excluded.project_id, model_provider = excluded.model_provider,
           model_name = excluded.model_name, permission_mode = excluded.permission_mode,
           bot_id = excluded.bot_id`
      )
      .run(
        input.kind,
        input.enabled ? 1 : 0,
        input.projectId,
        input.model?.provider ?? null,
        input.model?.model ?? null,
        input.permissionMode,
        botId
      )
    this.resetChangedChoices(before, this.get(input.kind))
    // Runs started under the old settings must not outlive them.
    this.abortRuns(input.kind)
    // Always reconnects, so saving a new token takes effect right away.
    this.enqueueReconnect(input.kind)
    return this.get(input.kind)
  }

  /** On Telegram the code comes with a link that sends it to the bot with one tap. */
  createPairingCode(kind: ChannelKind): PairingCode {
    const { code, expiresAt } = this.pairing.create(kind)
    const { account } = this.get(kind)
    const link =
      kind === 'telegram' && account
        ? `https://t.me/${encodeURIComponent(account)}?start=${code}`
        : null
    return { code, expiresAt, link }
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
    this.notifyChanged()
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
    await Promise.all([...this.threadQueues.values(), ...this.immediate])
  }

  register(router: RpcRouter): void {
    router.handle('channels.list', () => this.list())
    router.handle('channels.configure', (input) => this.configure(input))
    router.handle('channels.createPairingCode', ({ kind }) => this.createPairingCode(kind))
    router.handle('channels.pairings', ({ kind }) => this.pairings(kind))
    router.handle('channels.revokePairing', ({ kind, externalUserId }) =>
      this.revokePairing(kind, externalUserId)
    )
  }

  /** A setting changed in the app replaces what chats chose for it, so the newest decision wins. */
  private resetChangedChoices(before: Channel, after: Channel): void {
    const modelChanged =
      before.model === null || after.model === null
        ? before.model !== after.model
        : !sameModel(before.model, after.model)
    if (before.projectId !== after.projectId) this.choices.resetEverywhere(after.kind, 'projectId')
    if (modelChanged) this.choices.resetEverywhere(after.kind, 'model')
    if (before.botId !== after.botId) this.choices.resetEverywhere(after.kind, 'botId')
    if (before.permissionMode !== after.permissionMode) {
      this.choices.resetEverywhere(after.kind, 'permissionMode')
    }
  }

  /** Checks the bot first, so a bot deleted while the settings were open gets a clear error. */
  private existingBot(botId: string | null): string | null {
    if (botId !== null && !this.context.db.prepare('SELECT 1 FROM bots WHERE id = ?').get(botId)) {
      throw new Error('That bot no longer exists. Choose another one.')
    }
    return botId
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
      botId: row?.bot_id ?? null,
      state: connection.state,
      error: connection.error,
      account: connection.state === 'connected' ? (connection.account ?? null) : null
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
      await adapter.start((message) => this.receive(kind, adapter, message), CHANNEL_COMMANDS)
      this.adapters.set(kind, adapter)
      this.setConnection(kind, 'connected', null, adapter.accountName?.() ?? null)
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

  private setConnection(
    kind: ChannelKind,
    state: ChannelState,
    error: string | null,
    account: string | null = null
  ): void {
    this.connections.set(kind, { state, error, account })
    this.notifyChanged()
  }

  /** Also sent when someone pairs or is revoked, so the open settings show it right away. */
  private notifyChanged(): void {
    this.context.emit('channels.changed', this.list())
  }

  /**
   * Messages in one thread are handled in order. Different threads do not wait for each other.
   * Commands other than /new are answered at once, so /stop and /status work during a long answer.
   */
  private receive(kind: ChannelKind, adapter: ChannelAdapter, message: InboundMessage): void {
    if (message.isBot) return
    const command = parseCommand(message.text)
    if (command && command.name !== 'new') {
      const task: Promise<void> = this.handleCommand(kind, message, command)
        .catch((error: unknown) => console.warn(`Channel ${kind} failed to reply:`, error))
        .finally(() => this.immediate.delete(task))
      this.immediate.add(task)
      return
    }
    const key = threadKey(kind, message.threadId)
    const epoch = this.threadEpochs.get(key) ?? 0
    const previous = this.threadQueues.get(key) ?? Promise.resolve()
    const next = previous
      .then(() => this.handle(kind, adapter, message, epoch))
      // A failed reply must not stop later messages in the thread.
      .catch((error: unknown) => console.warn(`Channel ${kind} failed to reply:`, error))
      .finally(() => {
        if (this.threadQueues.get(key) === next) this.threadQueues.delete(key)
      })
    this.threadQueues.set(key, next)
  }

  /**
   * The checks every message passes before anything else happens. Returns true when the sender is
   * paired and the channel is on; otherwise it has already answered, if an answer is due.
   */
  private async admit(kind: ChannelKind, message: InboundMessage): Promise<boolean> {
    // First, because anyone can post a code, including a paired account or a locked out one.
    if (!message.isDirect && this.pairing.burnIfExposed(kind, message.text)) {
      await message.reply(REPLIES.codeExposed)
      return false
    }
    // A message can wait in the queue behind a long run, so the channel may be off by now.
    if (!this.isActive(kind)) return false

    if (!this.isPaired(kind, message.userId)) {
      await this.handleUnpaired(kind, message)
      return false
    }
    return true
  }

  private async handleCommand(
    kind: ChannelKind,
    message: InboundMessage,
    command: ParsedCommand
  ): Promise<void> {
    if (!(await this.admit(kind, message))) return
    const reply = await this.answerCommand(kind, message.threadId, command)
    await message.reply(reply.text, reply.choices)
  }

  private async answerCommand(
    kind: ChannelKind,
    threadId: string,
    { name, argument }: ParsedCommand
  ): Promise<CommandReply> {
    switch (name) {
      case 'help':
        return helpReply()
      case 'stop':
        return { text: this.stopThread(kind, threadId) ? REPLIES.stopped : REPLIES.nothingRunning }
      case 'status':
        return statusReply(await this.commandContext(kind, threadId))
      default: {
        const { reply, change } = pick(name, argument, await this.commandContext(kind, threadId))
        if (change && 'set' in change) this.choices.set(kind, threadId, change.set)
        if (change && 'reset' in change) this.choices.reset(kind, threadId, change.reset)
        return reply
      }
    }
  }

  /** Stops the running answer and drops the messages waiting behind it. */
  private stopThread(kind: ChannelKind, threadId: string): boolean {
    const key = threadKey(kind, threadId)
    const busy = this.threadQueues.has(key)
    this.threadEpochs.set(key, (this.threadEpochs.get(key) ?? 0) + 1)
    this.threadRuns.get(key)?.abort()
    return busy
  }

  private async commandContext(kind: ChannelKind, threadId: string): Promise<CommandContext> {
    const channel = this.get(kind)
    const current = this.threadSettings(channel, threadId)
    const defaults = this.channelSettings(channel)
    const readyProviders = (await this.providers.list())
      .filter((provider) => provider.configured)
      .map((provider) => provider.id)
    const { defaultModel, favoriteModels, recentModels } = this.settings.get()
    const models: ModelRef[] = []
    for (const model of [
      current.model,
      defaults.model,
      defaultModel,
      ...favoriteModels,
      ...recentModels
    ]) {
      if (!model || !readyProviders.includes(model.provider)) continue
      if (!models.some((known) => sameModel(known, model))) models.push(model)
    }
    return {
      defaults,
      current,
      choices: this.choices.get(kind, threadId),
      projects: this.projects.list(),
      bots: this.bots.list(),
      models,
      readyProviders,
      busy: this.threadQueues.has(threadKey(kind, threadId))
    }
  }

  private channelSettings(channel: Channel): ThreadSettings {
    return {
      projectId: channel.projectId,
      model: channel.model ?? this.settings.get().defaultModel,
      botId: channel.botId,
      permissionMode: channel.permissionMode
    }
  }

  /**
   * The channel settings with the thread's own choices applied. A project or bot deleted since it
   * was chosen falls back to the channel setting, and the permission mode never goes above the one
   * set in the app.
   */
  private threadSettings(channel: Channel, threadId: string): ThreadSettings {
    const defaults = this.channelSettings(channel)
    const choices = this.choices.get(channel.kind, threadId)
    const projectExists = (id: string | null): boolean =>
      id === null || this.projects.list().some((project) => project.id === id)
    const botExists = (id: string | null): boolean => id === null || !!this.bots.find(id)
    const permissionMode =
      choices.permissionMode &&
      PERMISSION_MODES.indexOf(choices.permissionMode) <
        PERMISSION_MODES.indexOf(defaults.permissionMode)
        ? choices.permissionMode
        : defaults.permissionMode
    return {
      projectId:
        choices.projectId !== undefined && projectExists(choices.projectId)
          ? choices.projectId
          : defaults.projectId,
      model: choices.model ?? defaults.model,
      botId:
        choices.botId !== undefined && botExists(choices.botId) ? choices.botId : defaults.botId,
      permissionMode
    }
  }

  private async handle(
    kind: ChannelKind,
    adapter: ChannelAdapter,
    message: InboundMessage,
    epoch: number
  ): Promise<void> {
    if (!(await this.admit(kind, message))) return
    const key = threadKey(kind, message.threadId)
    // Sent before /stop, which drops it.
    if ((this.threadEpochs.get(key) ?? 0) !== epoch) return

    const text = message.text.trim()
    if (!text) return
    // Opening the bot again, or a pairing link, is not a question for the agent.
    if (text === START_COMMAND) {
      await message.reply(REPLIES.ready)
      return
    }
    if (parsePairingCode(text)) {
      await message.reply(REPLIES.alreadyPaired)
      return
    }
    if (parseCommand(text)?.name === 'new') {
      this.unlinkThread(kind, message.threadId)
      await message.reply(REPLIES.newChat)
      return
    }

    const settings = this.threadSettings(this.get(kind), message.threadId)
    const { model } = settings
    if (!model) {
      await message.reply(REPLIES.noModel)
      return
    }

    const chatId = this.resolveChat(kind, message, settings, model)
    const stop = new AbortController()
    this.threadRuns.set(key, stop)
    const signal = AbortSignal.any([this.runSignal(kind), stop.signal])
    let reply: string
    try {
      const result = await this.runner.runHeadless({
        chatId,
        text,
        permissionMode: settings.permissionMode,
        source: 'channel',
        // A bot's memory holds personal facts, so it stays out of groups and channels.
        withMemory: message.isDirect,
        signal
      })
      reply = result.text.trim() || REPLIES.emptyResult
    } catch (error) {
      reply = `The run failed: ${error instanceof Error ? error.message : String(error)}`
    } finally {
      if (this.threadRuns.get(key) === stop) this.threadRuns.delete(key)
    }
    // /stop already answered.
    if (stop.signal.aborted) return
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
      if (!message.isDirect) await message.reply(REPLIES.pairInPrivate)
      else if (message.text.trim() === START_COMMAND) await message.reply(REPLIES.welcome(kind))
      else await message.reply(REPLIES.notPaired(kind))
      return
    }
    if (!message.isDirect) {
      await message.reply(REPLIES.pairInPrivate)
      return
    }
    const result = this.pairing.redeem(kind, message.userId, code)
    if (result === 'paired') {
      this.savePairing(kind, message)
      this.notifyChanged()
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
   * Reuses the chat linked to the thread unless the thread moved to another project or bot.
   * A thread without a project creates general chats, which have no tools.
   */
  private resolveChat(
    kind: ChannelKind,
    message: InboundMessage,
    { projectId, botId, permissionMode }: ThreadSettings,
    model: ModelRef
  ): string {
    const row = this.context.db
      .prepare('SELECT chat_id FROM channel_chats WHERE kind = ? AND external_thread_id = ?')
      .get(kind, message.threadId) as { chat_id: string } | undefined
    if (row) {
      const chat = this.chats.get(row.chat_id)
      if (chat.projectId === projectId && chat.botId === botId) {
        this.chats.update(chat.id, { model, permissionMode })
        return chat.id
      }
      this.unlinkThread(kind, message.threadId)
    }
    const chat = this.chats.create({
      projectId,
      botId,
      model,
      permissionMode,
      title: `${kind === 'telegram' ? 'Telegram' : 'Slack'}: ${message.displayName}`
    })
    this.context.db
      .prepare(
        'INSERT INTO channel_chats (kind, external_thread_id, chat_id, is_direct) VALUES (?, ?, ?, ?)'
      )
      .run(kind, message.threadId, chat.id, message.isDirect ? 1 : 0)
    return chat.id
  }
}

function threadKey(kind: ChannelKind, threadId: string): string {
  return `${kind}:${threadId}`
}
