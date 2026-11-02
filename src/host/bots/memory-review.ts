import { ToolLoopAgent, stepCountIs } from 'ai'
import type { Bot, BotMemory, Chat, ChatMessage, Project } from '@shared/types'
import { botInstructions } from '../agent/instructions'
import type { ModelResolver } from '../providers/resolve-model'
import type { ChatService } from '../services/chats'
import type { ProjectService } from '../services/projects'
import type { UsageRecorder } from '../services/usage'
import type { BotService } from './bot-service'
import { MEMORY_TOOL_NAME, createMemoryTool } from './memory-tool'

// A bot that learns looks back over its chats on its own and saves what will matter later, the way
// a person would after a conversation. The review runs after a reply is done, with nobody
// watching, and its only tool is memory. Its token use counts as the usage source `memory`.

/** A chat is reviewed each time its number of user messages reaches a multiple of this. */
export const MEMORY_REVIEW_INTERVAL = 10

/** Model calls one review may make. A few are enough to add, replace or remove some entries. */
export const MEMORY_REVIEW_MAX_STEPS = 4

/** The review reads at most this many characters of the conversation, keeping the newest. */
export const MEMORY_REVIEW_MAX_CHARACTERS = 24_000

export const NOTHING_TO_SAVE = 'Nothing to save.'

export interface MemoryReviewDependencies {
  chats: ChatService
  projects: ProjectService
  bots: BotService
  resolveModel: ModelResolver
  usage?: UsageRecorder
}

interface ActiveReview {
  botId: string
  projectId: string | null
  controller: AbortController
  finished: Promise<void>
}

function userMessageCount(messages: ChatMessage[]): number {
  return messages.filter(({ role }) => role === 'user').length
}

/** True when the newest user message brought the count to a multiple of the interval. */
export function isReviewDue(messages: ChatMessage[]): boolean {
  const count = userMessageCount(messages)
  return count > 0 && count % MEMORY_REVIEW_INTERVAL === 0
}

function messageText(message: ChatMessage): string {
  return message.parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('')
    .trim()
}

/**
 * The messages since the review before this one, as plain text. Tool calls and reasoning are left
 * out: what the user said and what the bot answered is what is worth remembering, and a plain
 * transcript keeps tool results the bot read from passing themselves off as the user.
 */
export function reviewTranscript(messages: ChatMessage[], botName: string): string {
  let usersSeen = 0
  let start = 0
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role !== 'user') continue
    usersSeen++
    start = index
    if (usersSeen === MEMORY_REVIEW_INTERVAL) break
  }

  const lines = messages.slice(start).flatMap((message) => {
    const text = messageText(message)
    if (!text) return []
    return [`${message.role === 'user' ? 'User' : botName}: ${text}`]
  })
  const transcript = lines.join('\n\n')
  if (transcript.length <= MEMORY_REVIEW_MAX_CHARACTERS) return transcript
  return `[Earlier messages left out]\n\n${transcript.slice(-MEMORY_REVIEW_MAX_CHARACTERS)}`
}

/** The bot's identity, soul and current memory, so it can tell what it already knows. */
export function reviewInstructions(bot: Bot, memories: BotMemory[]): string {
  return [
    `You are ${bot.name}. You are looking back over a conversation with the user to keep your ` +
      'memory current. Nobody sees this review. Your only tool is memory.',
    botInstructions(bot, memories)
  ].join('\n\n')
}

/** In the spirit of the background review in Hermes Agent, which is MIT licensed. */
export function reviewPrompt(transcript: string, botName: string): string {
  return [
    `This is the recent part of a conversation between the user and you, ${botName}. ` +
      'It is here to review, not to answer.',
    `<conversation>\n${transcript}\n</conversation>`,
    [
      'Review the conversation and decide whether anything in it is worth remembering.',
      'Save what will matter in later chats: who the user is, their preferences, corrections ' +
        'they made to you, and lasting facts about their work.',
      'Use "user" for facts about the user and "notes" for the rest. Save each fact once, in one ' +
        'kind only. If memory already holds it, leave it alone, or replace the entry when the ' +
        'conversation changed it.',
      'Skip small talk, task progress, one-off details and anything easy to look up again.',
      `If nothing stands out, answer "${NOTHING_TO_SAVE}" and stop.`
    ].join('\n')
  ].join('\n\n')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Runs memory reviews in the background. At most one runs per chat. A review never reports
 * anything to the chat: errors are only logged, because the reply it follows is already done.
 */
export class MemoryReviewer {
  private readonly active = new Map<string, ActiveReview>()
  private stopped = false

  constructor(private readonly dependencies: MemoryReviewDependencies) {
    // A review must not outlive the chat, project or bot it belongs to.
    dependencies.chats.onRemove((chatId) => this.active.get(chatId)?.controller.abort())
    dependencies.projects.onRemove((projectId) =>
      this.cancelWhere((review) => review.projectId === projectId)
    )
    dependencies.bots.onRemove((botId) => this.cancelWhere((review) => review.botId === botId))
  }

  /**
   * Call after a run that added a user message finished. Starts a review when the chat has a bot
   * that learns and the review is due. Returns right away and never throws.
   */
  afterRun(chatId: string): void {
    if (this.stopped || this.active.has(chatId)) return
    try {
      const { chats, bots, projects } = this.dependencies
      const chat = chats.get(chatId)
      const bot = chat.botId === null ? undefined : bots.find(chat.botId)
      if (!bot?.learns) return
      const messages = chats.messages(chatId)
      if (!isReviewDue(messages)) return

      const project = chat.projectId === null ? null : projects.get(chat.projectId)
      const controller = new AbortController()
      const finished = this.review(chat, project, bot, messages, controller.signal).finally(() =>
        this.active.delete(chatId)
      )
      this.active.set(chatId, { botId: bot.id, projectId: chat.projectId, controller, finished })
    } catch (error) {
      console.warn('Could not start a memory review:', errorMessage(error))
    }
  }

  isReviewing(chatId: string): boolean {
    return this.active.has(chatId)
  }

  /** Resolves when every review that is running now has ended. */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.active.values()].map(({ finished }) => finished))
  }

  /** Cancels every review and refuses new ones. Called when the host shuts down. */
  stop(): Promise<void> {
    this.stopped = true
    this.cancelWhere(() => true)
    return this.idle()
  }

  private cancelWhere(matches: (review: ActiveReview) => boolean): void {
    for (const review of this.active.values()) {
      if (matches(review)) review.controller.abort()
    }
  }

  private async review(
    chat: Chat,
    project: Project | null,
    bot: Bot,
    messages: ChatMessage[],
    signal: AbortSignal
  ): Promise<void> {
    const { bots, resolveModel, usage } = this.dependencies
    const recordings: Promise<void>[] = []
    try {
      const model = await resolveModel(chat.model)
      const agent = new ToolLoopAgent({
        model,
        instructions: reviewInstructions(bot, bots.memories(bot.id)),
        tools: { [MEMORY_TOOL_NAME]: createMemoryTool(bots, bot.id) },
        stopWhen: stepCountIs(MEMORY_REVIEW_MAX_STEPS),
        onLanguageModelCallEnd: (step) => {
          const recording = usage?.record({ chat, project, source: 'memory', step })
          if (recording) recordings.push(recording)
        }
      })
      await agent.generate({
        prompt: reviewPrompt(reviewTranscript(messages, bot.name), bot.name),
        abortSignal: signal
      })
    } catch (error) {
      if (!signal.aborted) console.warn('Memory review failed:', errorMessage(error))
    } finally {
      // The tokens were used even when the review failed or was cancelled.
      await Promise.allSettled(recordings)
    }
  }
}
