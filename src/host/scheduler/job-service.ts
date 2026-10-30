import { randomUUID } from 'node:crypto'
import type { JobInput } from '@shared/rpc'
import type { Job, JobRun, JobRunStatus, PermissionMode, ProviderId } from '@shared/types'
import type { AgentRunner } from '../agent-runner'
import type { HostContext } from '../context'
import type { RpcRouter } from '../rpc-router'
import type { ChatService } from '../services/chats'
import {
  assertValidCron,
  cronSchedule,
  nextFireTime,
  type Schedule,
  type ScheduledTask
} from './cron'

/** Run history shown per job. Older rows stay in the database. */
const RUN_HISTORY_LIMIT = 50

const MISSED_ERROR = 'The app was not running at the scheduled time.'
const INTERRUPTED_ERROR = 'The app stopped before this run finished.'

interface JobRow {
  id: string
  project_id: string
  name: string
  cron: string
  prompt: string
  model_provider: string
  model_name: string
  permission_mode: string
  enabled: number
  catch_up: number
  last_run_at: number | null
  scheduled_from: number
  created_at: number
}

interface JobRunRow {
  id: string
  job_id: string
  chat_id: string | null
  status: string
  started_at: number
  finished_at: number | null
  error: string | null
}

function toJobRun(row: JobRunRow): JobRun {
  return {
    id: row.id,
    jobId: row.job_id,
    chatId: row.chat_id,
    status: row.status as JobRunStatus,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error
  }
}

export interface JobServiceDependencies {
  chats: ChatService
  runner: AgentRunner
  /** Defaults to real cron timers. */
  schedule?: Schedule
}

export class JobService {
  private readonly tasks = new Map<string, ScheduledTask>()
  private readonly running = new Map<string, { abort: AbortController; done: Promise<void> }>()
  private readonly chats: ChatService
  private readonly runner: AgentRunner
  private readonly schedule: Schedule
  private started = false

  constructor(
    private readonly context: HostContext,
    dependencies: JobServiceDependencies
  ) {
    this.chats = dependencies.chats
    this.runner = dependencies.runner
    this.schedule = dependencies.schedule ?? cronSchedule
  }

  list(): Job[] {
    const rows = this.context.db
      .prepare('SELECT * FROM jobs ORDER BY created_at, rowid')
      .all() as unknown as JobRow[]
    return rows.map((row) => this.toJob(row))
  }

  get(id: string): Job {
    return this.toJob(this.getRow(id))
  }

  create(input: JobInput): Job {
    assertValidCron(input.cron)
    const id = randomUUID()
    const now = this.context.now()
    this.context.db
      .prepare(
        `INSERT INTO jobs
         (id, project_id, name, cron, prompt, model_provider, model_name, permission_mode,
          enabled, catch_up, scheduled_from, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.projectId,
        input.name,
        input.cron,
        input.prompt,
        input.model.provider,
        input.model.model,
        input.permissionMode,
        input.enabled ? 1 : 0,
        input.catchUp ? 1 : 0,
        now,
        now
      )
    if (this.started) this.arm(id)
    this.notify(input.projectId)
    return this.get(id)
  }

  update(id: string, patch: Partial<JobInput>): Job {
    if (patch.cron !== undefined) assertValidCron(patch.cron)
    const job = this.get(id)
    const next = { ...job, ...patch }
    // Moving the schedule start keeps a job that was off from counting as missed.
    const scheduleChanged =
      next.cron !== job.cron || (next.enabled && !job.enabled) ? this.context.now() : null
    this.context.db
      .prepare(
        `UPDATE jobs SET project_id = ?, name = ?, cron = ?, prompt = ?, model_provider = ?,
         model_name = ?, permission_mode = ?, enabled = ?, catch_up = ?,
         scheduled_from = COALESCE(?, scheduled_from) WHERE id = ?`
      )
      .run(
        next.projectId,
        next.name,
        next.cron,
        next.prompt,
        next.model.provider,
        next.model.model,
        next.permissionMode,
        next.enabled ? 1 : 0,
        next.catchUp ? 1 : 0,
        scheduleChanged,
        id
      )
    if (this.started) this.arm(id)
    this.notify(job.projectId)
    if (next.projectId !== job.projectId) this.notify(next.projectId)
    return this.get(id)
  }

  remove(id: string): void {
    const job = this.get(id)
    this.disarm(id)
    this.running.get(id)?.abort.abort()
    this.context.db.prepare('DELETE FROM jobs WHERE id = ?').run(id)
    this.notify(job.projectId)
  }

  /** Starts a run in the background. Throws if the job is already running. */
  runNow(id: string): void {
    const job = this.get(id)
    if (this.running.has(id)) throw new Error(`Job "${job.name}" is already running.`)
    this.begin(job)
  }

  runs(jobId: string): JobRun[] {
    const rows = this.context.db
      .prepare(
        'SELECT * FROM job_runs WHERE job_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?'
      )
      .all(jobId, RUN_HISTORY_LIMIT) as unknown as JobRunRow[]
    return rows.map(toJobRun)
  }

  isRunning(id: string): boolean {
    return this.running.has(id)
  }

  /** Call before a project is deleted: the database cascade alone leaves timers and runs alive. */
  handleProjectRemoved(projectId: string): void {
    const rows = this.context.db
      .prepare('SELECT id FROM jobs WHERE project_id = ?')
      .all(projectId) as unknown as { id: string }[]
    for (const { id } of rows) {
      this.disarm(id)
      this.running.get(id)?.abort.abort()
    }
  }

  /** Resolves once every run in progress has finished. */
  async settled(): Promise<void> {
    await Promise.all([...this.running.values()].map((run) => run.done))
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.closeInterruptedRuns()
    const rows = this.context.db
      .prepare('SELECT * FROM jobs WHERE enabled = 1')
      .all() as unknown as JobRow[]
    for (const row of rows) {
      this.catchUp(row)
      this.arm(row.id)
    }
  }

  async stop(): Promise<void> {
    this.started = false
    for (const id of [...this.tasks.keys()]) this.disarm(id)
    for (const run of this.running.values()) run.abort.abort()
    await this.settled()
  }

  register(router: RpcRouter): void {
    router.handle('jobs.list', () => this.list())
    router.handle('jobs.create', (input) => this.create(input))
    router.handle('jobs.update', ({ id, patch }) => this.update(id, patch))
    router.handle('jobs.remove', ({ id }) => this.remove(id))
    router.handle('jobs.runNow', ({ id }) => this.runNow(id))
    router.handle('jobs.runs', ({ jobId }) => this.runs(jobId))
  }

  private getRow(id: string): JobRow {
    const row = this.context.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as
      JobRow | undefined
    if (!row) throw new Error(`Job not found: ${id}`)
    return row
  }

  private toJob(row: JobRow): Job {
    const enabled = row.enabled === 1
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      cron: row.cron,
      prompt: row.prompt,
      model: { provider: row.model_provider as ProviderId, model: row.model_name },
      permissionMode: row.permission_mode as PermissionMode,
      enabled,
      catchUp: row.catch_up === 1,
      lastRunAt: row.last_run_at,
      nextRunAt: enabled ? nextFireTime(row.cron, this.context.now()) : null,
      createdAt: row.created_at
    }
  }

  private arm(id: string): void {
    this.disarm(id)
    const job = this.get(id)
    if (!job.enabled) return
    this.tasks.set(
      id,
      this.schedule(job.cron, () => this.fire(id))
    )
  }

  private disarm(id: string): void {
    this.tasks.get(id)?.stop()
    this.tasks.delete(id)
  }

  /** A scheduled tick. Skipped while the previous run of the job is still going. */
  private fire(id: string): void {
    if (this.running.has(id)) return
    // Throwing here would surface as an unhandled rejection inside the timer library.
    const exists = this.context.db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(id)
    if (!exists) {
      this.disarm(id)
      return
    }
    this.begin(this.get(id))
  }

  private begin(job: Job): void {
    const abort = new AbortController()
    const entry = { abort, done: Promise.resolve() }
    // Registered before the first await so a second tick can never start another run.
    this.running.set(job.id, entry)
    entry.done = this.execute(job, abort.signal).finally(() => {
      this.running.delete(job.id)
      this.notify(job.projectId)
    })
  }

  private async execute(job: Job, signal: AbortSignal): Promise<void> {
    const now = this.context.now()
    const runId = randomUUID()
    this.context.db
      .prepare('INSERT INTO job_runs (id, job_id, status, started_at) VALUES (?, ?, ?, ?)')
      .run(runId, job.id, 'running' satisfies JobRunStatus, now)
    this.context.db.prepare('UPDATE jobs SET last_run_at = ? WHERE id = ?').run(now, job.id)
    this.notify(job.projectId)

    try {
      const chat = this.chats.create({
        projectId: job.projectId,
        model: job.model,
        permissionMode: job.permissionMode,
        title: `Job: ${job.name}`
      })
      this.context.db.prepare('UPDATE job_runs SET chat_id = ? WHERE id = ?').run(chat.id, runId)
      await this.runner.runHeadless({
        chatId: chat.id,
        text: job.prompt,
        permissionMode: job.permissionMode,
        source: 'job',
        signal
      })
      this.finishRun(runId, 'succeeded', null)
    } catch (error) {
      this.finishRun(runId, 'failed', error instanceof Error ? error.message : String(error))
    }
  }

  private finishRun(runId: string, status: JobRunStatus, error: string | null): void {
    this.context.db
      .prepare('UPDATE job_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?')
      .run(status, this.context.now(), error, runId)
  }

  /** Handles at most one passed time per job, however many were passed. */
  private catchUp(row: JobRow): void {
    const latest = this.context.db
      .prepare('SELECT MAX(started_at) AS started_at FROM job_runs WHERE job_id = ?')
      .get(row.id) as { started_at: number | null }
    const since = Math.max(row.scheduled_from, row.last_run_at ?? 0, latest.started_at ?? 0)
    const now = this.context.now()
    const due = nextFireTime(row.cron, since)
    if (due === null || due > now) return

    if (row.catch_up === 1) {
      this.begin(this.toJob(row))
      return
    }
    this.context.db
      .prepare(
        `INSERT INTO job_runs (id, job_id, status, started_at, finished_at, error)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), row.id, 'missed' satisfies JobRunStatus, now, now, MISSED_ERROR)
    this.notify(row.project_id)
  }

  private closeInterruptedRuns(): void {
    this.context.db
      .prepare(
        `UPDATE job_runs SET status = 'failed', finished_at = ?, error = ?
         WHERE status = 'running'`
      )
      .run(this.context.now(), INTERRUPTED_ERROR)
  }

  private notify(projectId: string): void {
    this.context.emit('jobs.changed', { projectId })
  }
}
