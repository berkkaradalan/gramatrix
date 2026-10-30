import { CalendarClock } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatDateTime } from '../lib/format'
import {
  FREQUENCIES,
  FREQUENCY_LABELS,
  MINUTE_INTERVALS,
  WEEKDAY_NAMES,
  buildCron,
  nextRun,
  validateCron,
  type Frequency,
  type ScheduleDraft
} from '../lib/schedule'
import { Field, Select } from './ui'

const FREQUENCY_OPTIONS = FREQUENCIES.map((value) => ({ value, label: FREQUENCY_LABELS[value] }))
const INTERVAL_OPTIONS = MINUTE_INTERVALS.map((value) => ({
  value: String(value),
  label: `Every ${value} minutes`
}))
const WEEKDAY_OPTIONS = WEEKDAY_NAMES.map((label, value) => ({ value: String(value), label }))
const MONTH_DAY_OPTIONS = Array.from({ length: 28 }, (_, index) => ({
  value: String(index + 1),
  label: `Day ${index + 1}`
}))
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, index) => {
  const minute = index * 5
  return { value: String(minute), label: `${String(minute).padStart(2, '0')} past the hour` }
})

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: String(hour).padStart(2, '0')
}))

/** Offers five minute steps, plus the current minute if an existing job uses another value. */
function minuteOptions(current: number): { value: string; label: string }[] {
  const minutes = Array.from({ length: 12 }, (_, index) => index * 5)
  if (!minutes.includes(current)) minutes.push(current)
  return minutes
    .sort((first, second) => first - second)
    .map((minute) => ({ value: String(minute), label: String(minute).padStart(2, '0') }))
}

function TimeField({
  draft,
  onChange
}: {
  draft: ScheduleDraft
  onChange(patch: Partial<ScheduleDraft>): void
}): ReactNode {
  return (
    <Field label="Time">
      {(id) => (
        <div className="time-field">
          <Select
            id={id}
            ariaLabel="Hour"
            value={String(draft.hour)}
            options={HOUR_OPTIONS}
            onChange={(hour) => onChange({ hour: Number(hour) })}
          />
          <span aria-hidden="true">:</span>
          <Select
            ariaLabel="Minute"
            value={String(draft.minute)}
            options={minuteOptions(draft.minute)}
            onChange={(minute) => onChange({ minute: Number(minute) })}
          />
        </div>
      )}
    </Field>
  )
}

/** Builds a cron expression from plain choices and shows when it runs next. */
export function ScheduleBuilder({
  draft,
  onChange
}: {
  draft: ScheduleDraft
  onChange(draft: ScheduleDraft): void
}): ReactNode {
  const update = (patch: Partial<ScheduleDraft>): void => onChange({ ...draft, ...patch })
  const cron = buildCron(draft)
  const cronError = validateCron(cron)
  const upcoming = nextRun(cron)

  return (
    <div className="schedule">
      <div className="grid-two">
        <Field label="Repeat">
          {(id) => (
            <Select
              id={id}
              value={draft.frequency}
              options={FREQUENCY_OPTIONS}
              onChange={(frequency) =>
                onChange({
                  ...draft,
                  frequency: frequency as Frequency,
                  cron: frequency === 'custom' ? cron : draft.cron
                })
              }
            />
          )}
        </Field>
        {draft.frequency === 'minutes' && (
          <Field label="Interval">
            {(id) => (
              <Select
                id={id}
                value={String(draft.interval)}
                options={INTERVAL_OPTIONS}
                onChange={(interval) => update({ interval: Number(interval) })}
              />
            )}
          </Field>
        )}
        {draft.frequency === 'hourly' && (
          <Field label="Minute">
            {(id) => (
              <Select
                id={id}
                value={String(draft.minute - (draft.minute % 5))}
                options={MINUTE_OPTIONS}
                onChange={(minute) => update({ minute: Number(minute) })}
              />
            )}
          </Field>
        )}
        {(draft.frequency === 'daily' || draft.frequency === 'weekdays') && (
          <TimeField draft={draft} onChange={update} />
        )}
        {draft.frequency === 'weekly' && (
          <Field label="Day">
            {(id) => (
              <Select
                id={id}
                value={String(draft.weekday)}
                options={WEEKDAY_OPTIONS}
                onChange={(weekday) => update({ weekday: Number(weekday) })}
              />
            )}
          </Field>
        )}
        {draft.frequency === 'monthly' && (
          <Field label="Day of the month">
            {(id) => (
              <Select
                id={id}
                value={String(draft.monthDay)}
                options={MONTH_DAY_OPTIONS}
                onChange={(monthDay) => update({ monthDay: Number(monthDay) })}
              />
            )}
          </Field>
        )}
        {draft.frequency === 'custom' && (
          <Field label="Cron expression">
            {(id) => (
              <input
                id={id}
                className="input input-mono"
                spellCheck={false}
                aria-invalid={cronError !== null}
                value={draft.cron}
                onChange={(event) => update({ cron: event.target.value })}
              />
            )}
          </Field>
        )}
      </div>
      {(draft.frequency === 'weekly' || draft.frequency === 'monthly') && (
        <div className="grid-two">
          <TimeField draft={draft} onChange={update} />
        </div>
      )}
      <p className={cronError ? 'schedule-next schedule-error' : 'schedule-next'}>
        <CalendarClock size={14} aria-hidden />
        {cronError ?? (upcoming ? `Next run ${formatDateTime(upcoming.getTime())}` : 'No next run')}
      </p>
    </div>
  )
}
