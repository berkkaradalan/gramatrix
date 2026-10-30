import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCHEDULE,
  buildCron,
  describeSchedule,
  nextRun,
  parseCron,
  validateCron,
  type ScheduleDraft
} from './schedule'

function draft(patch: Partial<ScheduleDraft>): ScheduleDraft {
  return { ...DEFAULT_SCHEDULE, ...patch }
}

describe('buildCron', () => {
  it('builds each frequency', () => {
    expect(buildCron(draft({ frequency: 'minutes', interval: 15 }))).toBe('*/15 * * * *')
    expect(buildCron(draft({ frequency: 'hourly', minute: 5 }))).toBe('5 * * * *')
    expect(buildCron(draft({ frequency: 'daily', hour: 8, minute: 30 }))).toBe('30 8 * * *')
    expect(buildCron(draft({ frequency: 'weekdays' }))).toBe('0 9 * * 1-5')
    expect(buildCron(draft({ frequency: 'weekly', weekday: 3 }))).toBe('0 9 * * 3')
    expect(buildCron(draft({ frequency: 'monthly', monthDay: 15 }))).toBe('0 9 15 * *')
  })
})

describe('parseCron', () => {
  it('reads back everything buildCron makes', () => {
    const drafts = [
      draft({ frequency: 'minutes', interval: 30 }),
      draft({ frequency: 'hourly', minute: 10 }),
      draft({ frequency: 'daily', hour: 22, minute: 15 }),
      draft({ frequency: 'weekdays' }),
      draft({ frequency: 'weekly', weekday: 5 }),
      draft({ frequency: 'monthly', monthDay: 28 })
    ]
    for (const original of drafts) {
      const parsed = parseCron(buildCron(original))
      expect(parsed.frequency).toBe(original.frequency)
      expect(buildCron(parsed)).toBe(buildCron(original))
    }
  })

  it('keeps anything else as custom', () => {
    for (const cron of ['0 9 1 1 *', '*/7 * * * *', '0,30 9 * * *', 'nonsense']) {
      expect(parseCron(cron).frequency).toBe('custom')
    }
  })
})

describe('describeSchedule', () => {
  it('uses plain English', () => {
    expect(describeSchedule('*/5 * * * *')).toBe('Every 5 minutes')
    expect(describeSchedule('0 * * * *')).toBe('Every hour')
    expect(describeSchedule('0 9 * * *')).toBe('Every day at 09:00')
    expect(describeSchedule('30 18 * * 1-5')).toBe('Weekdays at 18:30')
    expect(describeSchedule('0 9 * * 1')).toBe('Mondays at 09:00')
    expect(describeSchedule('0 9 2 * *')).toBe('Day 2 of each month at 09:00')
  })

  it('falls back to the expression', () => {
    expect(describeSchedule('7 7 7 7 *')).toBe('7 7 7 7 *')
  })
})

describe('validateCron', () => {
  it('accepts valid expressions', () => {
    expect(validateCron('0,30 8-18 * * 1-5')).toBeNull()
  })

  it('requires five fields', () => {
    expect(validateCron('* * * *')).toContain('five fields')
  })

  it('rejects impossible values', () => {
    expect(validateCron('99 * * * *')).toContain('not a valid')
  })
})

describe('nextRun', () => {
  it('finds the next time', () => {
    const from = new Date(2026, 9, 30, 12, 0)
    expect(nextRun('0 13 * * *', from)).toEqual(new Date(2026, 9, 30, 13, 0))
  })

  it('returns null for invalid expressions', () => {
    expect(nextRun('nope')).toBeNull()
  })
})
