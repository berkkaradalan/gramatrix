import { describe, expect, it, vi } from 'vitest'
import type { JobInput } from '@shared/rpc'
import type { AgentRunner, HeadlessRunInput, HeadlessRunResult } from '../agent-runner'
import { createTestHost, type TestHost } from '../testing'
import type { Schedule } from './cron'
import { JobService } from './job-service'

const HOUR = 3_600_000

class FakeRunner implements AgentRunner {
  readonly calls: HeadlessRunInput[] = []
  private readonly gates: (() => void)[] = []
  blocking = false
  failure: Error | null = null

  async runHeadless(input: HeadlessRunInput): Promise<HeadlessRunResult> {
    this.calls.push(input)
    if (this.blocking) {
      await new Promise<void>((resolve) => {
        this.gates.push(resolve)
        input.signal?.addEventListener('abort', () => resolve())
      })
    }
    if (this.failure) throw this.failure
    return {
      text: 'done',
      message: { id: 'm', chatId: input.chatId, role: 'assistant', parts: [], createdAt: 0 }
    }
  }

  release(): void {
    for (const open of this.gates.splice(0)) open()
  }
}

interface Fixture extends TestHost {
  jobs: JobService
  runner: FakeRunner
  projectId: string
  ticks: Map<string, () => void>
  stopped: string[]
  input(overrides?: Partial<JobInput>): JobInput
}

function setup(): Fixture {
  const test = createTestHost()
  const runner = new FakeRunner()
  const ticks = new Map<string, () => void>()
  const stopped: string[] = []
  const schedule: Schedule = (expression, task) => {
    ticks.set(expression, task)
    return { stop: () => stopped.push(expression) }
  }
  const jobs = new JobService(test.context, { chats: test.host.services.chats, runner, schedule })
  const projectId = test.host.services.projects.add('/work/demo').id
  return {
    ...test,
    jobs,
    runner,
    projectId,
    ticks,
    stopped,
    input: (overrides) => ({
      projectId,
      name: 'Nightly',
      cron: '0 * * * *',
      prompt: 'Summarize',
      model: { provider: 'openai', model: 'test' },
      permissionMode: 'read-only',
      enabled: true,
      catchUp: false,
      ...overrides
    })
  }
}

/** Restarts the service the way an app launch does, after `elapsed` milliseconds closed. */
async function reopen(fixture: Fixture, elapsed: number): Promise<JobService> {
  await fixture.jobs.stop()
  fixture.clock.advance(elapsed)
  const jobs = new JobService(fixture.context, {
    chats: fixture.host.services.chats,
    runner: fixture.runner,
    schedule: () => ({ stop: () => {} })
  })
  jobs.start()
  return jobs
}

describe('JobService', () => {
  it.each(['not a cron', '* * * *', '* * * * * *', '61 * * * *', '@daily'])(
    'rejects the schedule %s',
    (cron) => {
      const { jobs, input } = setup()
      expect(() => jobs.create(input({ cron }))).toThrow(/schedule/i)
    }
  )

  it('rejects an invalid schedule on update and keeps the old one', () => {
    const { jobs, input } = setup()
    const job = jobs.create(input())
    expect(() => jobs.update(job.id, { cron: 'nope' })).toThrow(/schedule/i)
    expect(jobs.get(job.id).cron).toBe('0 * * * *')
  })

  it('computes the next run only for enabled jobs', () => {
    const { jobs, input, context } = setup()
    const enabled = jobs.create(input())
    const disabled = jobs.create(input({ enabled: false }))
    expect(enabled.nextRunAt).toBeGreaterThan(context.now())
    expect(disabled.nextRunAt).toBeNull()
  })

  it('records a run with its own chat and the configured permission mode', async () => {
    const { jobs, input, runner, host, projectId } = setup()
    const job = jobs.create(input({ permissionMode: 'accept-edits' }))
    jobs.runNow(job.id)
    await jobs.settled()

    const [run] = jobs.runs(job.id)
    expect(run?.status).toBe('succeeded')
    expect(run?.chatId).toBe(runner.calls[0]?.chatId)
    expect(runner.calls[0]?.text).toBe('Summarize')
    expect(runner.calls[0]?.permissionMode).toBe('accept-edits')
    expect(runner.calls[0]?.source).toBe('job')
    expect(host.services.chats.list(projectId)[0]?.title).toBe('Job: Nightly')
    expect(jobs.get(job.id).lastRunAt).not.toBeNull()
  })

  it('stores the error of a failed run', async () => {
    const { jobs, input, runner } = setup()
    runner.failure = new Error('model refused')
    const job = jobs.create(input())
    jobs.runNow(job.id)
    await jobs.settled()
    expect(jobs.runs(job.id)[0]).toMatchObject({ status: 'failed', error: 'model refused' })
  })

  it('never runs the same job twice at once', async () => {
    const { jobs, input, runner, ticks } = setup()
    runner.blocking = true
    const job = jobs.create(input())
    jobs.start()
    const tick = ticks.get(job.cron)!

    tick()
    tick()
    expect(() => jobs.runNow(job.id)).toThrow('already running')
    expect(runner.calls).toHaveLength(1)

    runner.release()
    await jobs.settled()
    tick()
    expect(runner.calls).toHaveLength(2)
    runner.release()
    await jobs.settled()
  })

  it('runs a job with catch up once however many times were passed', async () => {
    const fixture = setup()
    const job = fixture.jobs.create(fixture.input({ catchUp: true }))
    const jobs = await reopen(fixture, 5 * HOUR)
    await jobs.settled()
    expect(fixture.runner.calls).toHaveLength(1)
    expect(jobs.runs(job.id).map((run) => run.status)).toEqual(['succeeded'])
  })

  it('records one missed run without catch up and does not repeat it', async () => {
    const fixture = setup()
    const job = fixture.jobs.create(fixture.input())
    const jobs = await reopen(fixture, 5 * HOUR)
    expect(fixture.runner.calls).toHaveLength(0)
    expect(jobs.runs(job.id).map((run) => run.status)).toEqual(['missed'])

    await jobs.stop()
    const again = await reopen(fixture, 1000)
    expect(again.runs(job.id)).toHaveLength(1)
  })

  it('does nothing on start when no scheduled time passed', async () => {
    const fixture = setup()
    const job = fixture.jobs.create(fixture.input({ cron: '0 0 1 1 *' }))
    // A yearly schedule cannot pass in one second unless the clock sits on the boundary.
    const jobs = await reopen(fixture, 1000)
    expect(jobs.runs(job.id)).toEqual([])
  })

  it('does not count time spent disabled as missed', async () => {
    const fixture = setup()
    const job = fixture.jobs.create(fixture.input({ enabled: false }))
    fixture.clock.advance(5 * HOUR)
    fixture.jobs.update(job.id, { enabled: true })
    const jobs = await reopen(fixture, 1000)
    expect(jobs.runs(job.id)).toEqual([])
  })

  it('closes runs left open by a crash', async () => {
    const fixture = setup()
    const job = fixture.jobs.create(fixture.input({ enabled: false }))
    fixture.jobs.runNow(job.id)
    await fixture.jobs.settled()
    // A crash never reaches the finish step, so recreate the row it leaves behind.
    fixture.context.db.prepare("UPDATE job_runs SET status = 'running', finished_at = NULL").run()

    fixture.jobs.start()
    expect(fixture.jobs.runs(job.id)[0]).toMatchObject({ status: 'failed' })
    await fixture.jobs.stop()
  })

  it('stops the timer and aborts the run when a job is removed', async () => {
    const { jobs, input, runner, stopped } = setup()
    runner.blocking = true
    const job = jobs.create(input())
    jobs.start()
    jobs.runNow(job.id)
    const signal = runner.calls[0]?.signal
    jobs.remove(job.id)
    expect(signal?.aborted).toBe(true)
    expect(stopped).toContain(job.cron)
    await jobs.settled()
    expect(() => jobs.get(job.id)).toThrow('Job not found')
  })

  it('stops the timers and aborts the runs of a removed project', async () => {
    const { jobs, input, runner, stopped, host, projectId } = setup()
    runner.blocking = true
    const job = jobs.create(input())
    const other = host.services.projects.add('/work/other')
    const kept = jobs.create(input({ projectId: other.id, cron: '30 * * * *' }))
    jobs.start()
    jobs.runNow(job.id)
    const signal = runner.calls[0]?.signal

    jobs.handleProjectRemoved(projectId)
    expect(signal?.aborted).toBe(true)
    expect(stopped).toEqual([job.cron])
    host.services.projects.remove(projectId)
    await jobs.settled()
    expect(jobs.get(kept.id).enabled).toBe(true)
    await jobs.stop()
  })

  it('ignores and disarms a timer whose job no longer exists', async () => {
    const { jobs, input, ticks, stopped, host, projectId, runner } = setup()
    const job = jobs.create(input())
    jobs.start()
    host.services.projects.remove(projectId)

    expect(() => ticks.get(job.cron)!()).not.toThrow()
    expect(stopped).toEqual([job.cron])
    expect(runner.calls).toEqual([])
    await jobs.stop()
  })

  it('re-arms the timer when the schedule changes', async () => {
    const { jobs, input, ticks, stopped } = setup()
    const job = jobs.create(input())
    jobs.start()
    jobs.update(job.id, { cron: '30 * * * *' })
    expect(stopped).toContain('0 * * * *')
    expect(ticks.has('30 * * * *')).toBe(true)
    await jobs.stop()
  })

  it('announces changes', () => {
    const { jobs, input, events, projectId } = setup()
    jobs.create(input())
    expect(events).toContainEqual({ event: 'jobs.changed', payload: { projectId } })
  })

  it('serves the RPC methods', async () => {
    const { jobs, input, host, projectId } = setup()
    jobs.register(host.router)
    const created = (await host.router.dispatch('jobs.create', input())) as { id: string }
    await host.router.dispatch('jobs.update', { id: created.id, patch: { name: 'Weekly' } })
    const list = (await host.router.dispatch('jobs.list', { projectId })) as { name: string }[]
    expect(list.map((job) => job.name)).toEqual(['Weekly'])
    await host.router.dispatch('jobs.remove', { id: created.id })
    expect(await host.router.dispatch('jobs.list', { projectId })).toEqual([])
  })

  it('uses real timers by default', () => {
    const fixture = setup()
    const jobs = new JobService(fixture.context, {
      chats: fixture.host.services.chats,
      runner: fixture.runner
    })
    const spy = vi.spyOn(fixture.runner, 'runHeadless')
    jobs.create(fixture.input())
    jobs.start()
    void jobs.stop()
    expect(spy).not.toHaveBeenCalled()
  })
})
