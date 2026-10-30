import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import {
  ToolLoopAgent,
  stepCountIs,
  type LanguageModel,
  type TextStreamPart,
  type ToolSet
} from 'ai'
import { secretName } from '@shared/rpc'
import type {
  ApprovalRequest,
  Chat,
  ChatMessage,
  MessagePart,
  PermissionMode,
  Project,
  UsageSource
} from '@shared/types'
import type { AgentRunner, HeadlessRunInput, HeadlessRunResult } from '../agent-runner'
import type { HostContext } from '../context'
import { providerEntry } from '../providers/catalog'
import { explainFailure, failureDetails } from '../providers/provider-errors'
import type { ModelResolver } from '../providers/resolve-model'
import type { RpcRouter } from '../rpc-router'
import { NEW_CHAT_TITLE, type ChatService } from '../services/chats'
import type { ProjectService } from '../services/projects'
import type { StepUsage, UsageRecorder } from '../services/usage'
import { CommandRegistry } from './commands'
import { toModelMessages } from './history'
import { GENERAL_CHAT_INSTRUCTIONS, agentInstructions } from './instructions'
import { ApprovalBroker, lowerPermissionMode } from './permissions'
import { RunRecorder, type RunEventBody } from './run-recorder'
import { createRunTools, type RunScope } from './run-tools'

export const MAX_AGENT_STEPS = 50
const MAX_TITLE_LENGTH = 60
/** How long `stop` waits for runs and commands. The main process stops waiting at 3 seconds. */
export const STOP_GRACE_MS = 1000

export interface AgentServiceDependencies {
  chats: ChatService
  projects: ProjectService
  resolveModel: ModelResolver
  usage?: UsageRecorder
}

interface ActiveRun {
  controller: AbortController
  finished?: Promise<unknown>
}

interface RunOptions {
  chat: Chat
  /** New user message. Left out when retrying, because it is already stored. */
  text?: string
  runId: string
  interactive: boolean
  /** Caps the mode stored on the chat. It can never raise it. */
  permissionLimit?: PermissionMode
  source: UsageSource
  controller: AbortController
}

type RunOutcome =
  | { status: 'finished'; message: ChatMessage; text: string }
  | { status: 'cancelled' }
  | { status: 'failed'; error: string }

function titleFrom(text: string): string {
  const firstLine = text.trim().split('\n')[0] ?? ''
  if (firstLine.length <= MAX_TITLE_LENGTH) return firstLine || NEW_CHAT_TITLE
  return `${firstLine.slice(0, MAX_TITLE_LENGTH - 3).trimEnd()}...`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class AgentService implements AgentRunner {
  private readonly approvals = new ApprovalBroker()
  private readonly commands = new CommandRegistry()
  private readonly activeRuns = new Map<string, ActiveRun>()

  constructor(
    private readonly context: HostContext,
    private readonly dependencies: AgentServiceDependencies
  ) {}

  /** Starts a run that reports through events and returns as soon as it has started. */
  send(chatId: string, text: string): { runId: string } {
    const chat = this.dependencies.chats.get(chatId)
    const runId = randomUUID()
    const controller = this.claimChat(chatId)
    void this.run({ chat, text, runId, interactive: true, source: 'chat', controller })
    return { runId }
  }

  retry(chatId: string): { runId: string } {
    const { chats } = this.dependencies
    const chat = chats.get(chatId)
    const lastUserMessage = chats.messages(chatId).findLast(({ role }) => role === 'user')
    if (!lastUserMessage) throw new Error('This chat has no message to retry.')
    const runId = randomUUID()
    const controller = this.claimChat(chatId)
    chats.removeMessagesAfter(chatId, lastUserMessage.id)
    void this.run({ chat, runId, interactive: true, source: 'chat', controller })
    return { runId }
  }

  async runHeadless(input: HeadlessRunInput): Promise<HeadlessRunResult> {
    const chat = this.dependencies.chats.get(input.chatId)
    const controller = this.claimChat(chat.id)
    const abort = (): void => controller.abort()
    input.signal?.addEventListener('abort', abort, { once: true })
    if (input.signal?.aborted) controller.abort()

    try {
      const outcome = await this.run({
        chat,
        text: input.text,
        runId: randomUUID(),
        interactive: false,
        permissionLimit: input.permissionMode,
        source: input.source,
        controller
      })
      if (outcome.status === 'finished') return outcome
      throw new Error(outcome.status === 'failed' ? outcome.error : 'The run was cancelled.')
    } finally {
      input.signal?.removeEventListener('abort', abort)
    }
  }

  resolveApproval(requestId: string, approved: boolean): void {
    this.approvals.resolve(requestId, approved)
  }

  pendingApprovals(chatId: string): ApprovalRequest[] {
    return this.approvals.forChat(chatId)
  }

  cancel(chatId: string): void {
    this.activeRuns.get(chatId)?.controller.abort()
  }

  isRunning(chatId: string): boolean {
    return this.activeRuns.has(chatId)
  }

  /**
   * Cancels every run and kills every command started by this service, including background
   * processes left by commands that already finished. Called when the host shuts down.
   */
  async stop(): Promise<void> {
    const runs = [...this.activeRuns.values()]
    for (const run of runs) run.controller.abort()
    await Promise.all([
      this.commands.killAll(STOP_GRACE_MS),
      Promise.race([
        Promise.allSettled(runs.map((run) => run.finished)),
        delay(STOP_GRACE_MS, undefined, { ref: false })
      ])
    ])
  }

  register(router: RpcRouter): void {
    router.handle('agent.send', ({ chatId, text }) => this.send(chatId, text))
    router.handle('agent.retry', ({ chatId }) => this.retry(chatId))
    router.handle('agent.cancel', ({ chatId }) => this.cancel(chatId))
    router.handle('agent.resolveApproval', ({ requestId, approved }) =>
      this.resolveApproval(requestId, approved)
    )
    router.handle('agent.pendingApprovals', ({ chatId }) => this.pendingApprovals(chatId))
  }

  /** Reserves the chat synchronously, so two sends cannot both start a run. */
  private claimChat(chatId: string): AbortController {
    if (this.activeRuns.has(chatId)) throw new Error('This chat already has an active run.')
    const controller = new AbortController()
    this.activeRuns.set(chatId, { controller })
    return controller
  }

  private run(options: RunOptions): Promise<RunOutcome> {
    const finished = this.executeRun(options)
    const active = this.activeRuns.get(options.chat.id)
    if (active) active.finished = finished
    return finished
  }

  private async executeRun(options: RunOptions): Promise<RunOutcome> {
    const { chat, text, runId, controller } = options
    const { chats } = this.dependencies
    const chatId = chat.id
    const emit = (event: RunEventBody): void =>
      this.context.emit('run.event', { ...event, runId, chatId })

    let recorder: RunRecorder | undefined
    const emitFinal = (event: RunEventBody): void => {
      recorder?.close()
      emit(event)
    }

    const assistantMessageId = randomUUID()
    try {
      if (text !== undefined) {
        chats.saveMessage({
          id: randomUUID(),
          chatId,
          role: 'user',
          parts: [{ type: 'text', text }],
          createdAt: this.context.now()
        })
        if (chat.title === NEW_CHAT_TITLE) chats.update(chatId, { title: titleFrom(text) })
      }

      emit({ type: 'started', messageId: assistantMessageId })
      const createdAt = this.context.now()
      const saveParts = (parts: MessagePart[]): void => {
        try {
          chats.saveMessage({ id: assistantMessageId, chatId, role: 'assistant', parts, createdAt })
        } catch (error) {
          // Removing a chat cancels its run, so a late save can find the chat already gone.
          if (!controller.signal.aborted) throw error
        }
      }
      recorder = new RunRecorder({ emit, save: saveParts })

      const model = await this.dependencies.resolveModel(chat.model)
      const streamError = await this.streamAgent(options, model, recorder)
      recorder.flush()

      if (controller.signal.aborted) {
        emitFinal({ type: 'cancelled' })
        return { status: 'cancelled' }
      }
      if (streamError !== undefined) throw streamError

      emitFinal({ type: 'finished' })
      const message = chats.messages(chatId).find(({ id }) => id === assistantMessageId)
      return {
        status: 'finished',
        text: recorder.finalText(),
        message: message ?? {
          id: assistantMessageId,
          chatId,
          role: 'assistant',
          parts: [],
          createdAt
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        emitFinal({ type: 'cancelled' })
        return { status: 'cancelled' }
      }
      const message = await this.describeFailure(chat, error)
      emitFinal({ type: 'failed', error: message })
      return { status: 'failed', error: message }
    } finally {
      this.activeRuns.delete(chatId)
    }
  }

  /** Tools exist only here, so a general chat can never reach them or the permission check. */
  private projectAgentSetup(
    { chat, interactive, permissionLimit, controller }: RunOptions,
    project: Project,
    model: LanguageModel,
    recorder: RunRecorder,
    recordSubagentStep: (step: StepUsage) => void
  ): { instructions: string; tools: ToolSet } {
    const scope: RunScope = {
      chatId: chat.id,
      root: project.path,
      permissionMode: () => {
        // Throws once the chat is gone, which refuses the tool call.
        const stored = this.dependencies.chats.get(chat.id).permissionMode
        return permissionLimit ? lowerPermissionMode(permissionLimit, stored) : stored
      },
      interactive,
      signal: controller.signal,
      model,
      recorder,
      approvals: this.approvals,
      commands: this.commands,
      recordSubagentStep
    }
    return { instructions: agentInstructions(project.path), tools: createRunTools(scope) }
  }

  /** Runs the agent loop. Returns the error reported by the stream, if there was one. */
  private async streamAgent(
    options: RunOptions,
    model: LanguageModel,
    recorder: RunRecorder
  ): Promise<unknown> {
    const { chat, controller, source } = options
    const project = chat.projectId === null ? null : this.dependencies.projects.get(chat.projectId)
    const recordings: Promise<void>[] = []
    const record = (stepSource: UsageSource, step: StepUsage): void => {
      const recording = this.dependencies.usage?.record({ chat, project, source: stepSource, step })
      if (recording) recordings.push(recording)
    }

    const setup = project
      ? this.projectAgentSetup(options, project, model, recorder, (step) =>
          record('subagent', step)
        )
      : { instructions: GENERAL_CHAT_INSTRUCTIONS, tools: {} }
    const agent = new ToolLoopAgent({
      model,
      ...setup,
      stopWhen: stepCountIs(MAX_AGENT_STEPS),
      // Errors are read from the stream below, so the default console logging is not needed.
      onError: () => {},
      // Not `finish-step`, which waits for the tools. A command can run for minutes and be
      // cancelled, and the tokens of the model call that started it were used either way.
      onLanguageModelCallEnd: (call) => record(source, call)
    })

    const result = await agent.stream({
      messages: toModelMessages(this.dependencies.chats.messages(chat.id)),
      abortSignal: controller.signal
    })

    let streamError: unknown
    try {
      for await (const part of result.fullStream) {
        streamError = this.handleStreamPart(part, recorder) ?? streamError
      }
    } finally {
      // Saved even when the run failed or was cancelled, because the tokens were still used.
      await Promise.allSettled(recordings)
    }
    return streamError
  }

  /** Returns the error if this part reports one. */
  private handleStreamPart(part: TextStreamPart<ToolSet>, recorder: RunRecorder): unknown {
    switch (part.type) {
      case 'text-delta':
        recorder.textDelta(part.text)
        break
      case 'reasoning-delta':
        recorder.reasoningDelta(part.text)
        break
      case 'tool-error':
        recorder.toolRejected(
          part.toolCallId,
          part.toolName,
          part.input,
          `Error: ${errorMessage(part.error)}`
        )
        break
      case 'finish-step':
        recorder.flush()
        break
      case 'error':
        return part.error
    }
    return undefined
  }

  /** The same explanation as a key test, so a failed run tells people what to do next. */
  private async describeFailure(chat: Chat, error: unknown): Promise<string> {
    const { provider, model } = chat.model
    const key = await this.context.getSecret(secretName.provider(provider))
    const details = failureDetails(error, providerEntry(provider).baseUrl, model, key)
    return details.status === undefined
      ? errorMessage(error)
      : explainFailure(provider, details, key)
  }
}
