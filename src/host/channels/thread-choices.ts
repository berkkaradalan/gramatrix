import type { ChannelKind, ModelRef, PermissionMode } from '@shared/types'
import type { HostContext } from '../context'

/**
 * Settings one conversation chose with chat commands, on top of the channel settings. A missing
 * field means the channel setting applies. `projectId` and `botId` can be null, which is a real
 * choice: no project, or plain Gramatrix.
 */
export interface ThreadChoices {
  projectId?: string | null
  model?: ModelRef
  botId?: string | null
  permissionMode?: PermissionMode
}

export type ThreadChoice = keyof ThreadChoices

/** Stores the choices of each channel conversation in the `channel_threads` table. */
export class ThreadChoiceStore {
  constructor(private readonly context: HostContext) {}

  get(kind: ChannelKind, threadId: string): ThreadChoices {
    const row = this.context.db
      .prepare('SELECT choices FROM channel_threads WHERE kind = ? AND external_thread_id = ?')
      .get(kind, threadId) as { choices: string } | undefined
    return row ? (JSON.parse(row.choices) as ThreadChoices) : {}
  }

  set(kind: ChannelKind, threadId: string, patch: ThreadChoices): void {
    this.save(kind, threadId, { ...this.get(kind, threadId), ...patch })
  }

  /** Goes back to the channel setting for one choice of one conversation. */
  reset(kind: ChannelKind, threadId: string, choice: ThreadChoice): void {
    const choices = this.get(kind, threadId)
    delete choices[choice]
    this.save(kind, threadId, choices)
  }

  /**
   * Drops a choice in every conversation of a channel. Used when the same setting changes in the
   * app, so the newest decision wins everywhere.
   */
  resetEverywhere(kind: ChannelKind, choice: ThreadChoice): void {
    const rows = this.context.db
      .prepare('SELECT external_thread_id, choices FROM channel_threads WHERE kind = ?')
      .all(kind) as unknown as { external_thread_id: string; choices: string }[]
    for (const row of rows) {
      const choices = JSON.parse(row.choices) as ThreadChoices
      if (!(choice in choices)) continue
      delete choices[choice]
      this.save(kind, row.external_thread_id, choices)
    }
  }

  private save(kind: ChannelKind, threadId: string, choices: ThreadChoices): void {
    if (Object.keys(choices).length === 0) {
      this.context.db
        .prepare('DELETE FROM channel_threads WHERE kind = ? AND external_thread_id = ?')
        .run(kind, threadId)
      return
    }
    this.context.db
      .prepare(
        `INSERT INTO channel_threads (kind, external_thread_id, choices) VALUES (?, ?, ?)
         ON CONFLICT(kind, external_thread_id) DO UPDATE SET choices = excluded.choices`
      )
      .run(kind, threadId, JSON.stringify(choices))
  }
}
