import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { Project } from '@shared/types'
import type { HostContext } from '../context'
import type { RpcRouter } from '../rpc-router'

interface ProjectRow {
  id: string
  name: string
  path: string
  created_at: number
  last_opened_at: number
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at
  }
}

export class ProjectService {
  private readonly removalListeners: ((id: string) => void)[] = []

  constructor(private readonly context: HostContext) {}

  /** Runs before a project is deleted, while its chats and jobs still exist. */
  onRemove(listener: (id: string) => void): void {
    this.removalListeners.push(listener)
  }

  list(): Project[] {
    const rows = this.context.db
      .prepare('SELECT * FROM projects ORDER BY last_opened_at DESC')
      .all() as unknown as ProjectRow[]
    return rows.map(toProject)
  }

  get(id: string): Project {
    const row = this.context.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      ProjectRow | undefined
    if (!row) throw new Error(`Project not found: ${id}`)
    return toProject(row)
  }

  add(path: string): Project {
    const now = this.context.now()
    this.context.db
      .prepare(
        `INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET last_opened_at = excluded.last_opened_at`
      )
      .run(randomUUID(), basename(path), path, now, now)
    const row = this.context.db
      .prepare('SELECT * FROM projects WHERE path = ?')
      .get(path) as unknown as ProjectRow
    return toProject(row)
  }

  remove(id: string): void {
    for (const listener of this.removalListeners) listener(id)
    this.context.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  }

  touch(id: string): Project {
    this.context.db
      .prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?')
      .run(this.context.now(), id)
    return this.get(id)
  }

  register(router: RpcRouter): void {
    router.handle('projects.list', () => this.list())
    router.handle('projects.add', ({ path }) => this.add(path))
    router.handle('projects.remove', ({ id }) => this.remove(id))
    router.handle('projects.touch', ({ id }) => this.touch(id))
  }
}
