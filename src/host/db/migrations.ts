/**
 * Ordered schema migrations. Add a new entry to change the schema and never edit an
 * existing one, because it may already have run on a user's machine.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_opened_at INTEGER NOT NULL
  );

  CREATE TABLE chats (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    model_provider TEXT NOT NULL,
    model_name TEXT NOT NULL,
    permission_mode TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX chats_by_project ON chats(project_id, updated_at DESC);

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    parts TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX messages_by_chat ON messages(chat_id, created_at);

  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    cron TEXT NOT NULL,
    prompt TEXT NOT NULL,
    model_provider TEXT NOT NULL,
    model_name TEXT NOT NULL,
    permission_mode TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    catch_up INTEGER NOT NULL,
    last_run_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE job_runs (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    chat_id TEXT REFERENCES chats(id) ON DELETE SET NULL,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    error TEXT
  );
  CREATE INDEX job_runs_by_job ON job_runs(job_id, started_at DESC);

  CREATE TABLE channels (
    kind TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    model_provider TEXT,
    model_name TEXT,
    permission_mode TEXT NOT NULL
  );

  CREATE TABLE channel_pairings (
    kind TEXT NOT NULL,
    external_user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    paired_at INTEGER NOT NULL,
    PRIMARY KEY (kind, external_user_id)
  );

  CREATE TABLE channel_chats (
    kind TEXT NOT NULL,
    external_thread_id TEXT NOT NULL,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    PRIMARY KEY (kind, external_thread_id)
  );
  `,
  // The moment a job's current schedule took effect. Times before it never count as missed.
  `
  ALTER TABLE jobs ADD COLUMN scheduled_from INTEGER NOT NULL DEFAULT 0;
  UPDATE jobs SET scheduled_from = created_at;
  `,
  // Makes chats.project_id nullable for general chats. SQLite cannot drop NOT NULL, so the table
  // is rebuilt. This is only safe because `migrate` turns foreign keys off, otherwise DROP TABLE
  // would cascade to messages and channel_chats.
  `
  CREATE TABLE chats_rebuilt (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    model_provider TEXT NOT NULL,
    model_name TEXT NOT NULL,
    permission_mode TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  INSERT INTO chats_rebuilt
    (id, project_id, title, model_provider, model_name, permission_mode, created_at, updated_at)
    SELECT id, project_id, title, model_provider, model_name, permission_mode, created_at, updated_at
    FROM chats;
  DROP TABLE chats;
  ALTER TABLE chats_rebuilt RENAME TO chats;
  CREATE INDEX chats_by_project ON chats(project_id, updated_at DESC);
  `,
  // One row per model step. Links are cleared rather than cascaded, and the labels are copied, so
  // totals and reports stay complete after a chat or project is deleted.
  `
  CREATE TABLE usage_events (
    id TEXT PRIMARY KEY,
    chat_id TEXT REFERENCES chats(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    source TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cached_input_tokens INTEGER NOT NULL,
    reasoning_tokens INTEGER NOT NULL,
    cost REAL,
    project_label TEXT,
    model_label TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX usage_events_by_time ON usage_events(created_at);
  CREATE INDEX usage_events_by_chat ON usage_events(chat_id);
  CREATE INDEX usage_events_by_project ON usage_events(project_id);
  `
]
