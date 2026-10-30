import { mkdtempSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase, type Database } from './database'
import { MIGRATIONS } from './migrations'

function databasePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'gramatrix-db-')), 'test.db')
}

/** Writes a database exactly as version 2 of the schema left it. */
function createVersionTwoDatabase(path: string): void {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  for (const sql of MIGRATIONS.slice(0, 2)) db.exec(sql)
  db.exec('PRAGMA user_version = 2')
  db.exec(`
    INSERT INTO projects VALUES ('p1', 'Demo', '/work/demo', 1, 1);
    INSERT INTO chats VALUES ('c1', 'p1', 'First', 'openai', 'gpt', 'ask', 1, 2);
    INSERT INTO chats VALUES ('c2', 'p1', 'Second', 'zai', 'glm', 'read-only', 3, 4);
    INSERT INTO messages VALUES ('m1', 'c1', 'user', '[]', 1);
    INSERT INTO messages VALUES ('m2', 'c1', 'assistant', '[]', 2);
    INSERT INTO messages VALUES ('m3', 'c2', 'user', '[]', 3);
    INSERT INTO jobs
      (id, project_id, name, cron, prompt, model_provider, model_name, permission_mode, enabled,
       catch_up, created_at, scheduled_from)
      VALUES ('j1', 'p1', 'Nightly', '0 0 * * *', 'go', 'openai', 'gpt', 'ask', 1, 0, 1, 1);
    INSERT INTO job_runs VALUES ('r1', 'j1', 'c1', 'succeeded', 1, 2, NULL);
    INSERT INTO channel_chats VALUES ('telegram', 'thread', 'c2');
  `)
  db.close()
}

function count(db: Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }
  return row.total
}

describe('openDatabase', () => {
  it('leaves foreign keys on and the schema current', () => {
    const db = openDatabase(':memory:')
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: MIGRATIONS.length })
  })

  it('does nothing on a second open', () => {
    const path = databasePath()
    openDatabase(path).close()
    expect(() => openDatabase(path).close()).not.toThrow()
  })

  it('rolls back a failed migration and still turns foreign keys on', () => {
    const path = databasePath()
    const db = new DatabaseSync(path)
    db.exec(MIGRATIONS[0]!)
    // Version 1 with a conflicting column makes the next migration fail.
    db.exec('ALTER TABLE jobs ADD COLUMN scheduled_from INTEGER')
    db.exec('PRAGMA user_version = 1')
    db.close()

    expect(() => openDatabase(path)).toThrow()
    const reopened = new DatabaseSync(path)
    expect(reopened.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 })
    reopened.close()
  })
})

describe('general chat migration', () => {
  it('keeps every row that depends on chats', () => {
    const path = databasePath()
    createVersionTwoDatabase(path)

    const db = openDatabase(path)

    expect(count(db, 'chats')).toBe(2)
    expect(count(db, 'messages')).toBe(3)
    expect(count(db, 'job_runs')).toBe(1)
    expect(count(db, 'channel_chats')).toBe(1)
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(db.prepare('SELECT chat_id FROM job_runs').get()).toEqual({ chat_id: 'c1' })
    expect(db.prepare('SELECT * FROM chats WHERE id = ?').get('c2')).toEqual({
      id: 'c2',
      project_id: 'p1',
      title: 'Second',
      model_provider: 'zai',
      model_name: 'glm',
      permission_mode: 'read-only',
      created_at: 3,
      updated_at: 4
    })
  })

  it('allows a chat without a project', () => {
    const path = databasePath()
    createVersionTwoDatabase(path)
    const db = openDatabase(path)
    db.exec(`INSERT INTO chats VALUES ('c3', NULL, 'General', 'openai', 'gpt', 'ask', 5, 5)`)
    expect(count(db, 'chats')).toBe(3)
  })

  it('still rejects a chat with an unknown project', () => {
    const path = databasePath()
    createVersionTwoDatabase(path)
    const db = openDatabase(path)
    expect(() =>
      db.exec(`INSERT INTO chats VALUES ('c3', 'nope', 'Bad', 'openai', 'gpt', 'ask', 5, 5)`)
    ).toThrow()
  })

  it('still cascades from projects to chats and messages, and frees job run links', () => {
    const path = databasePath()
    createVersionTwoDatabase(path)
    const db = openDatabase(path)
    db.exec(`INSERT INTO chats VALUES ('c3', NULL, 'General', 'openai', 'gpt', 'ask', 5, 5)`)

    db.exec(`DELETE FROM chats WHERE id = 'c1'`)
    expect(count(db, 'messages')).toBe(1)
    expect(db.prepare('SELECT chat_id FROM job_runs').get()).toEqual({ chat_id: null })

    db.exec(`DELETE FROM projects WHERE id = 'p1'`)
    expect(db.prepare('SELECT id FROM chats').all()).toEqual([{ id: 'c3' }])
    expect(count(db, 'channel_chats')).toBe(0)
  })

  it('keeps the index', () => {
    const path = databasePath()
    createVersionTwoDatabase(path)
    const db = openDatabase(path)
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'chats_by_project'`)
      .get()
    expect(row).toEqual({ name: 'chats_by_project' })
  })
})

describe('usage events migration', () => {
  it('keeps rows when their chat or project is deleted', () => {
    const db = openDatabase(':memory:')
    db.exec(`
      INSERT INTO projects VALUES ('p1', 'Demo', '/work/demo', 1, 1);
      INSERT INTO chats VALUES ('c1', 'p1', 'First', 'openai', 'gpt', 'ask', 1, 2);
      INSERT INTO usage_events
        (id, chat_id, project_id, provider, model, source, input_tokens, output_tokens,
         cached_input_tokens, reasoning_tokens, project_label, model_label, created_at)
        VALUES ('u1', 'c1', 'p1', 'openai', 'gpt', 'chat', 1, 1, 0, 0, 'Demo', 'GPT', 1);
    `)
    db.exec(`DELETE FROM projects WHERE id = 'p1'`)
    expect(db.prepare('SELECT chat_id, project_id, project_label FROM usage_events').get()).toEqual(
      {
        chat_id: null,
        project_id: null,
        project_label: 'Demo'
      }
    )
  })
})
