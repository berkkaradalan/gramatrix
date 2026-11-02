import { randomUUID } from 'node:crypto'
import type { BotInput } from '@shared/rpc'
import {
  BOT_ICONS,
  BOT_PICTURE_MAX_LENGTH,
  MEMORY_LIMITS,
  SOUL_LIMIT,
  type Bot,
  type BotMemory,
  type MemoryKind,
  type ProviderId
} from '@shared/types'
import type { HostContext } from '../context'
import type { RpcRouter } from '../rpc-router'
import { memoryWriteProblem } from './memory-safety'

const MAX_NAME_LENGTH = 40

interface BotRow {
  id: string
  name: string
  soul: string
  model_provider: string
  model_name: string
  learns: number
  project_id: string | null
  avatar: string | null
  created_at: number
  updated_at: number
}

interface MemoryRow {
  id: string
  bot_id: string
  kind: string
  content: string
  created_at: number
  updated_at: number
}

function toBot(row: BotRow): Bot {
  return {
    id: row.id,
    name: row.name,
    soul: row.soul,
    model: { provider: row.model_provider as ProviderId, model: row.model_name },
    learns: row.learns === 1,
    projectId: row.project_id,
    avatar: row.avatar,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toMemory(row: MemoryRow): BotMemory {
  return {
    id: row.id,
    botId: row.bot_id,
    kind: row.kind as MemoryKind,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** A change the bot asks for through its memory tool. Entries are found by a piece of their text. */
export type MemoryChange =
  | { action: 'add'; kind: MemoryKind; content: string }
  | { action: 'replace'; kind: MemoryKind; oldText: string; content: string }
  | { action: 'remove'; kind: MemoryKind; oldText: string }

function cleanName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A bot needs a name.')
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new Error(`A bot name can be at most ${MAX_NAME_LENGTH} characters.`)
  }
  return trimmed
}

function cleanSoul(soul: string): string {
  const trimmed = soul.trim()
  if (trimmed.length > SOUL_LIMIT) {
    throw new Error(`The soul can be at most ${SOUL_LIMIT} characters.`)
  }
  return trimmed
}

const PICTURE_PREFIX = 'data:image/png;base64,'

function checkAvatar(avatar: string | null): string | null {
  if (avatar === null || (BOT_ICONS as readonly string[]).includes(avatar)) return avatar
  if (!avatar.startsWith(PICTURE_PREFIX))
    throw new Error('That is not a picture Gramatrix can use.')
  if (avatar.length > BOT_PICTURE_MAX_LENGTH) throw new Error('That picture is too large.')
  return avatar
}

function cleanEntry(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) throw new Error('A memory entry cannot be empty.')
  return trimmed
}

export class BotService {
  private readonly removalListeners: ((id: string) => void)[] = []

  constructor(private readonly context: HostContext) {}

  /** Runs before a bot is deleted. */
  onRemove(listener: (id: string) => void): void {
    this.removalListeners.push(listener)
  }

  list(): Bot[] {
    const rows = this.context.db
      .prepare('SELECT * FROM bots ORDER BY name COLLATE NOCASE')
      .all() as unknown as BotRow[]
    return rows.map(toBot)
  }

  find(id: string): Bot | undefined {
    const row = this.context.db.prepare('SELECT * FROM bots WHERE id = ?').get(id) as
      BotRow | undefined
    return row && toBot(row)
  }

  get(id: string): Bot {
    const bot = this.find(id)
    if (!bot) throw new Error(`Bot not found: ${id}`)
    return bot
  }

  create(input: BotInput): Bot {
    const now = this.context.now()
    const id = randomUUID()
    this.context.db
      .prepare(
        `INSERT INTO bots (id, name, soul, model_provider, model_name, learns, project_id, avatar,
         created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        cleanName(input.name),
        cleanSoul(input.soul),
        input.model.provider,
        input.model.model,
        input.learns ? 1 : 0,
        input.projectId ?? null,
        checkAvatar(input.avatar ?? null),
        now,
        now
      )
    this.notify(id)
    return this.get(id)
  }

  update(id: string, patch: Partial<BotInput>): Bot {
    const next = { ...this.get(id), ...patch }
    this.context.db
      .prepare(
        `UPDATE bots SET name = ?, soul = ?, model_provider = ?, model_name = ?, learns = ?,
         project_id = ?, avatar = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        cleanName(next.name),
        cleanSoul(next.soul),
        next.model.provider,
        next.model.model,
        next.learns ? 1 : 0,
        next.projectId,
        checkAvatar(next.avatar),
        this.context.now(),
        id
      )
    this.notify(id)
    return this.get(id)
  }

  /** Deletes the bot and its memory. Its chats stay and become plain chats. */
  remove(id: string): void {
    this.get(id)
    for (const listener of this.removalListeners) listener(id)
    this.context.db.prepare('DELETE FROM bots WHERE id = ?').run(id)
    this.notify(id)
  }

  memories(botId: string, kind?: MemoryKind): BotMemory[] {
    const { db } = this.context
    const rows = (kind === undefined
      ? db
          .prepare('SELECT * FROM bot_memories WHERE bot_id = ? ORDER BY created_at, rowid')
          .all(botId)
      : db
          .prepare(
            'SELECT * FROM bot_memories WHERE bot_id = ? AND kind = ? ORDER BY created_at, rowid'
          )
          .all(botId, kind)) as unknown as MemoryRow[]
    return rows.map(toMemory)
  }

  /** Adds an entry the user wrote. Only the size limit applies, because the user wrote it. */
  addMemory(botId: string, kind: MemoryKind, content: string): BotMemory {
    this.get(botId)
    const entry = cleanEntry(content)
    this.assertFits(botId, kind, entry.length)
    return this.insertMemory(botId, kind, entry)
  }

  /** Changes an entry the user edited. */
  updateMemory(id: string, content: string): BotMemory {
    const memory = this.getMemory(id)
    const entry = cleanEntry(content)
    this.assertFits(memory.botId, memory.kind, entry.length - memory.content.length)
    this.context.db
      .prepare('UPDATE bot_memories SET content = ?, updated_at = ? WHERE id = ?')
      .run(entry, this.context.now(), id)
    this.notify(memory.botId)
    return this.getMemory(id)
  }

  removeMemory(id: string): void {
    const memory = this.getMemory(id)
    this.context.db.prepare('DELETE FROM bot_memories WHERE id = ?').run(id)
    this.notify(memory.botId)
  }

  /**
   * Applies a change the bot asked for and describes the result for the model. Its writes are
   * checked for planted instructions and secrets, since they may come from what it read.
   */
  changeMemory(botId: string, change: MemoryChange): string {
    this.get(botId)
    const { kind } = change
    if (change.action !== 'remove') {
      const problem = memoryWriteProblem(change.content)
      if (problem) throw new Error(`This was not saved because ${problem}.`)
    }

    switch (change.action) {
      case 'add': {
        const entry = cleanEntry(change.content)
        this.assertFits(botId, kind, entry.length)
        this.insertMemory(botId, kind, entry)
        break
      }
      case 'replace': {
        const memory = this.findEntry(botId, kind, change.oldText)
        this.updateMemory(memory.id, change.content)
        break
      }
      case 'remove':
        this.removeMemory(this.findEntry(botId, kind, change.oldText).id)
        break
    }
    return `Done. The "${kind}" memory uses ${this.usedCharacters(botId, kind)} of ${MEMORY_LIMITS[kind]} characters.`
  }

  usedCharacters(botId: string, kind: MemoryKind): number {
    return this.memories(botId, kind).reduce((total, { content }) => total + content.length, 0)
  }

  register(router: RpcRouter): void {
    router.handle('bots.list', () => this.list())
    router.handle('bots.create', (input) => this.create(input))
    router.handle('bots.update', ({ id, patch }) => this.update(id, patch))
    router.handle('bots.remove', ({ id }) => this.remove(id))
    router.handle('bots.memories', ({ botId }) => this.memories(botId))
    router.handle('bots.addMemory', ({ botId, kind, content }) =>
      this.addMemory(botId, kind, content)
    )
    router.handle('bots.updateMemory', ({ id, content }) => this.updateMemory(id, content))
    router.handle('bots.removeMemory', ({ id }) => this.removeMemory(id))
  }

  private getMemory(id: string): BotMemory {
    const row = this.context.db.prepare('SELECT * FROM bot_memories WHERE id = ?').get(id) as
      MemoryRow | undefined
    if (!row) throw new Error(`Memory entry not found: ${id}`)
    return toMemory(row)
  }

  private insertMemory(botId: string, kind: MemoryKind, content: string): BotMemory {
    const id = randomUUID()
    const now = this.context.now()
    this.context.db
      .prepare(
        `INSERT INTO bot_memories (id, bot_id, kind, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, botId, kind, content, now, now)
    this.notify(botId)
    return this.getMemory(id)
  }

  /** Lists the entries in the error, so the bot can choose what to shorten or remove. */
  private assertFits(botId: string, kind: MemoryKind, addedCharacters: number): void {
    const used = this.usedCharacters(botId, kind)
    const limit = MEMORY_LIMITS[kind]
    if (used + addedCharacters <= limit) return
    const entries = this.memories(botId, kind).map(({ content }) => `- ${content}`)
    throw new Error(
      [
        `The "${kind}" memory is full: ${used} of ${limit} characters are used and this needs ` +
          `${addedCharacters} more. Remove or shorten entries first. Current entries:`,
        ...entries
      ].join('\n')
    )
  }

  private findEntry(botId: string, kind: MemoryKind, oldText: string): BotMemory {
    const needle = oldText.trim()
    const matches = needle
      ? this.memories(botId, kind).filter(({ content }) => content.includes(needle))
      : []
    if (matches.length === 1 && matches[0]) return matches[0]
    throw new Error(
      matches.length === 0
        ? `No entry in the "${kind}" memory contains that text.`
        : `${matches.length} entries contain that text. Quote more of the one you mean.`
    )
  }

  private notify(botId: string): void {
    this.context.emit('bots.changed', { botId })
  }
}
