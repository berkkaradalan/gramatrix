import { randomUUID } from 'node:crypto'
import type {
  Chat,
  ChatMessage,
  MessagePart,
  MessageRole,
  ModelRef,
  PermissionMode,
  ProviderId
} from '@shared/types'
import type { HostContext } from '../context'
import type { RpcRouter } from '../rpc-router'

interface ChatRow {
  id: string
  project_id: string | null
  title: string
  model_provider: string
  model_name: string
  permission_mode: string
  created_at: number
  updated_at: number
}

interface MessageRow {
  id: string
  chat_id: string
  role: string
  parts: string
  created_at: number
}

function toChat(row: ChatRow): Chat {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    model: { provider: row.model_provider as ProviderId, model: row.model_name },
    permissionMode: row.permission_mode as PermissionMode,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role as MessageRole,
    parts: JSON.parse(row.parts) as MessagePart[],
    createdAt: row.created_at
  }
}

export const NEW_CHAT_TITLE = 'New chat'

export class ChatService {
  private readonly removalListeners: ((id: string) => void)[] = []

  constructor(private readonly context: HostContext) {}

  /** Runs before a chat is deleted. */
  onRemove(listener: (id: string) => void): void {
    this.removalListeners.push(listener)
  }

  /** Every chat, or only those of one project. */
  list(projectId?: string): Chat[] {
    const { db } = this.context
    const rows = (projectId === undefined
      ? db.prepare('SELECT * FROM chats ORDER BY updated_at DESC').all()
      : db
          .prepare('SELECT * FROM chats WHERE project_id = ? ORDER BY updated_at DESC')
          .all(projectId)) as unknown as ChatRow[]
    return rows.map(toChat)
  }

  get(id: string): Chat {
    const row = this.context.db.prepare('SELECT * FROM chats WHERE id = ?').get(id) as
      ChatRow | undefined
    if (!row) throw new Error(`Chat not found: ${id}`)
    return toChat(row)
  }

  create(input: {
    /** Null makes a general chat. */
    projectId: string | null
    model: ModelRef
    permissionMode: PermissionMode
    title?: string
  }): Chat {
    const now = this.context.now()
    const id = randomUUID()
    this.context.db
      .prepare(
        `INSERT INTO chats
         (id, project_id, title, model_provider, model_name, permission_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.projectId,
        input.title ?? NEW_CHAT_TITLE,
        input.model.provider,
        input.model.model,
        input.permissionMode,
        now,
        now
      )
    this.notify(input.projectId)
    return this.get(id)
  }

  update(
    id: string,
    patch: { title?: string; model?: ModelRef; permissionMode?: PermissionMode }
  ): Chat {
    const chat = this.get(id)
    const next = { ...chat, ...patch }
    this.context.db
      .prepare(
        `UPDATE chats SET title = ?, model_provider = ?, model_name = ?, permission_mode = ?,
         updated_at = ? WHERE id = ?`
      )
      .run(
        next.title,
        next.model.provider,
        next.model.model,
        next.permissionMode,
        this.context.now(),
        id
      )
    this.notify(chat.projectId)
    return this.get(id)
  }

  remove(id: string): void {
    const chat = this.get(id)
    for (const listener of this.removalListeners) listener(id)
    this.context.db.prepare('DELETE FROM chats WHERE id = ?').run(id)
    this.notify(chat.projectId)
  }

  messages(chatId: string): ChatMessage[] {
    const rows = this.context.db
      .prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at, rowid')
      .all(chatId) as unknown as MessageRow[]
    return rows.map(toMessage)
  }

  /** Deletes every message after the given one. */
  removeMessagesAfter(chatId: string, messageId: string): void {
    const messages = this.messages(chatId)
    const index = messages.findIndex(({ id }) => id === messageId)
    const statement = this.context.db.prepare('DELETE FROM messages WHERE id = ?')
    for (const { id } of messages.slice(index + 1)) statement.run(id)
  }

  /** Inserts a message, or replaces its parts when the id already exists. */
  saveMessage(message: ChatMessage): void {
    this.context.db
      .prepare(
        `INSERT INTO messages (id, chat_id, role, parts, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET parts = excluded.parts`
      )
      .run(
        message.id,
        message.chatId,
        message.role,
        JSON.stringify(message.parts),
        message.createdAt
      )
    this.context.db
      .prepare('UPDATE chats SET updated_at = ? WHERE id = ?')
      .run(this.context.now(), message.chatId)
  }

  private notify(projectId: string | null): void {
    this.context.emit('chats.changed', { projectId })
  }

  register(router: RpcRouter): void {
    router.handle('chats.list', () => this.list())
    router.handle('chats.create', ({ projectId, model, permissionMode }) =>
      this.create({ projectId, model, permissionMode: permissionMode ?? 'ask' })
    )
    router.handle('chats.update', ({ id, ...patch }) => this.update(id, patch))
    router.handle('chats.remove', ({ id }) => this.remove(id))
    router.handle('chats.messages', ({ chatId }) => this.messages(chatId))
  }
}
