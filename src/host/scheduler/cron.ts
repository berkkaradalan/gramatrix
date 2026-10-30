import { Cron } from 'croner'

const CRON_FIELD_COUNT = 5

/** Throws a readable error unless `expression` is a five field cron that can fire. */
export function assertValidCron(expression: string): void {
  if (expression.trim().split(/\s+/).length !== CRON_FIELD_COUNT) {
    throw new Error(
      `Invalid schedule "${expression}". Use five fields: minute hour day month weekday.`
    )
  }
  let next: Date | null
  try {
    next = new Cron(expression).nextRun()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid schedule "${expression}": ${reason}`, { cause: error })
  }
  if (!next) throw new Error(`Schedule "${expression}" never fires.`)
}

/** First time the expression fires strictly after `after`, in the local time zone. */
export function nextFireTime(expression: string, after: number): number | null {
  return new Cron(expression).nextRun(new Date(after))?.getTime() ?? null
}

export interface ScheduledTask {
  stop(): void
}

/** Calls `task` every time the expression fires. Replaced by a fake in tests. */
export type Schedule = (expression: string, task: () => void) => ScheduledTask

export const cronSchedule: Schedule = (expression, task) => new Cron(expression, task)
