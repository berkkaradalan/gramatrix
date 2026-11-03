import {
  MEMORY_LIMITS,
  type Bot,
  type BotMemory,
  type MemoryKind,
  type ToolCallPart
} from '@shared/types'

/** The tool a bot uses to change its own memory. Matches the name in the host. */
export const MEMORY_TOOL_NAME = 'memory'

/** The bot page shows what it knows about you first. */
export const MEMORY_KIND_ORDER: readonly MemoryKind[] = ['user', 'notes']

export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  user: 'About you',
  notes: 'Notes'
}

export const MEMORY_KIND_HINTS: Record<MemoryKind, string> = {
  user: 'Who you are, how you like to work and corrections you gave.',
  notes: 'Everything else worth keeping, such as facts about your projects.'
}

export interface MemoryUsage {
  used: number
  limit: number
  /** Share of the limit in use, from 0 to 1. */
  ratio: number
}

/** Characters one kind of memory uses. The host counts the trimmed text of each entry. */
export function memoryUsage(memories: BotMemory[], kind: MemoryKind): MemoryUsage {
  const used = memories
    .filter((memory) => memory.kind === kind)
    .reduce((total, { content }) => total + content.length, 0)
  const limit = MEMORY_LIMITS[kind]
  return { used, limit, ratio: Math.min(used / limit, 1) }
}

/**
 * How many characters a draft is over the limit, or 0 when it fits. When the draft replaces an
 * entry, the old text no longer counts.
 */
export function memoryOverflow(
  memories: BotMemory[],
  kind: MemoryKind,
  draft: string,
  replacing?: BotMemory
): number {
  const { used, limit } = memoryUsage(memories, kind)
  const freed = replacing ? replacing.content.length : 0
  return Math.max(used - freed + draft.trim().length - limit, 0)
}

/** The bots in a list by id, for quick lookups from chat rows. */
export function botsById(bots: Bot[]): Map<string, Bot> {
  return new Map(bots.map((bot) => [bot.id, bot]))
}

/** One letter for the avatar of a bot. */
export function botInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

/** The first line of the soul, for list rows. */
export function soulPreview(soul: string): string {
  return soul.trim().split('\n')[0]?.trim() ?? ''
}

type MemoryAction = 'add' | 'replace' | 'remove'

const ACTION_LABELS: Record<MemoryAction, { running: string; done: string; failed: string }> = {
  add: {
    running: 'Saving to memory',
    done: 'Saved to memory',
    failed: 'Could not save to memory'
  },
  replace: {
    running: 'Updating memory',
    done: 'Updated memory',
    failed: 'Could not update memory'
  },
  remove: {
    running: 'Removing from memory',
    done: 'Removed from memory',
    failed: 'Could not remove from memory'
  }
}

export interface MemoryCallView {
  label: string
  /** "About you" or "Notes", when the bot said which. */
  kindLabel: string | null
  /** The entry as saved, or the text that picked the entry to remove. */
  content: string
  /** The text that picked the entry to replace. */
  previous: string | null
  /** The reason it failed, without the "Error:" prefix. */
  error: string | null
  failed: boolean
}

function text(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Describes a memory tool call in plain words. The input may still be streaming in, so every
 * field is optional.
 */
export function describeMemoryCall(part: ToolCallPart): MemoryCallView {
  const input =
    typeof part.input === 'object' && part.input !== null
      ? (part.input as Record<string, unknown>)
      : {}
  const action = text(input, 'action')
  const labels = ACTION_LABELS[action as MemoryAction] ?? ACTION_LABELS.add
  const kind = text(input, 'kind')
  const output = typeof part.output === 'string' ? part.output.trim() : ''
  const outputFailed = output.startsWith('Error:')
  const failed = part.state === 'failed' || part.state === 'denied' || outputFailed
  const running = part.state === 'running' || part.state === 'awaiting-approval'
  const oldText = text(input, 'oldText')

  return {
    label: failed ? labels.failed : running ? labels.running : labels.done,
    kindLabel: kind in MEMORY_KIND_LABELS ? MEMORY_KIND_LABELS[kind as MemoryKind] : null,
    content: action === 'remove' ? oldText : text(input, 'content'),
    previous: action === 'replace' && oldText ? oldText : null,
    error: failed ? readableMemoryError(output) : null,
    failed
  }
}

/**
 * Turns a memory error into one readable sentence. A full memory error lists every entry for the
 * model, which the person already sees, so only the first line stays.
 */
export function readableMemoryError(message: string): string {
  const firstLine = message.replace(/^Error:\s*/, '').split('\n')[0] ?? ''
  return (
    firstLine
      .replace(/\s*Current entries:$/, '')
      .replace(/"user" memory/g, '"About you" memory')
      .replace(/"notes" memory/g, '"Notes" memory')
      .trim() || 'The memory did not change.'
  )
}
