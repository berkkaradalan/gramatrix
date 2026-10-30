import { Cron } from 'croner'

export const FREQUENCIES = [
  'minutes',
  'hourly',
  'daily',
  'weekdays',
  'weekly',
  'monthly',
  'custom'
] as const
export type Frequency = (typeof FREQUENCIES)[number]

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  minutes: 'Every few minutes',
  hourly: 'Every hour',
  daily: 'Every day',
  weekdays: 'Every weekday',
  weekly: 'Every week',
  monthly: 'Every month',
  custom: 'Custom cron'
}

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
] as const

export const MINUTE_INTERVALS = [5, 10, 15, 30] as const

/** The friendly form of a schedule. Anything it cannot express stays as a custom expression. */
export interface ScheduleDraft {
  frequency: Frequency
  interval: number
  hour: number
  minute: number
  weekday: number
  monthDay: number
  cron: string
}

export const DEFAULT_SCHEDULE: ScheduleDraft = {
  frequency: 'weekdays',
  interval: 15,
  hour: 9,
  minute: 0,
  weekday: 1,
  monthDay: 1,
  cron: '0 9 * * 1-5'
}

export function buildCron(draft: ScheduleDraft): string {
  const { hour, minute, weekday, monthDay, interval } = draft
  switch (draft.frequency) {
    case 'minutes':
      return `*/${interval} * * * *`
    case 'hourly':
      return `${minute} * * * *`
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekdays':
      return `${minute} ${hour} * * 1-5`
    case 'weekly':
      return `${minute} ${hour} * * ${weekday}`
    case 'monthly':
      return `${minute} ${hour} ${monthDay} * *`
    case 'custom':
      return draft.cron.trim()
  }
}

const NUMBER = /^\d+$/

/** Reads a cron expression back into the form, or marks it custom when no form matches. */
export function parseCron(expression: string): ScheduleDraft {
  const cron = expression.trim().replace(/\s+/g, ' ')
  const custom: ScheduleDraft = { ...DEFAULT_SCHEDULE, frequency: 'custom', cron }
  const fields = cron.split(' ')
  if (fields.length !== 5) return custom
  const [minute = '', hour = '', monthDay = '', month = '', weekday = ''] = fields
  if (month !== '*') return custom

  const step = /^\*\/(\d+)$/.exec(minute)
  if (step && hour === '*' && monthDay === '*' && weekday === '*') {
    const interval = Number(step[1])
    if ((MINUTE_INTERVALS as readonly number[]).includes(interval)) {
      return { ...custom, frequency: 'minutes', interval }
    }
    return custom
  }
  if (!NUMBER.test(minute)) return custom
  const base = { ...custom, minute: Number(minute) }
  if (hour === '*' && monthDay === '*' && weekday === '*') return { ...base, frequency: 'hourly' }
  if (!NUMBER.test(hour)) return custom
  const timed = { ...base, hour: Number(hour) }
  if (monthDay === '*' && weekday === '*') return { ...timed, frequency: 'daily' }
  if (monthDay === '*' && weekday === '1-5') return { ...timed, frequency: 'weekdays' }
  if (monthDay === '*' && NUMBER.test(weekday) && Number(weekday) <= 6) {
    return { ...timed, frequency: 'weekly', weekday: Number(weekday) }
  }
  if (weekday === '*' && NUMBER.test(monthDay)) {
    return { ...timed, frequency: 'monthly', monthDay: Number(monthDay) }
  }
  return custom
}

export function formatClock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function describeSchedule(expression: string): string {
  const draft = parseCron(expression)
  const time = formatClock(draft.hour, draft.minute)
  switch (draft.frequency) {
    case 'minutes':
      return `Every ${draft.interval} minutes`
    case 'hourly':
      return draft.minute === 0
        ? 'Every hour'
        : `Every hour at ${String(draft.minute).padStart(2, '0')} past`
    case 'daily':
      return `Every day at ${time}`
    case 'weekdays':
      return `Weekdays at ${time}`
    case 'weekly':
      return `${WEEKDAY_NAMES[draft.weekday]}s at ${time}`
    case 'monthly':
      return `Day ${draft.monthDay} of each month at ${time}`
    case 'custom':
      return draft.cron
  }
}

/** Returns a message for an expression that cannot be scheduled. */
export function validateCron(expression: string): string | null {
  if (expression.trim().split(/\s+/).filter(Boolean).length !== 5) {
    return 'Use five fields: minute, hour, day of month, month, day of week.'
  }
  try {
    new Cron(expression.trim(), { paused: true })
    return null
  } catch {
    return 'This is not a valid cron expression.'
  }
}

export function nextRun(expression: string, from: Date = new Date()): Date | null {
  if (validateCron(expression)) return null
  return new Cron(expression.trim(), { paused: true }).nextRun(from)
}
