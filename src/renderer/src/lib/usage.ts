import type { UsageRow, UsageTotals } from '@shared/types'

export const USAGE_RANGES = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: 'all', label: 'All', days: null }
] as const

export type UsageRangeId = (typeof USAGE_RANGES)[number]['id']

/** Start of the range, at local midnight, so today counts as a full day. */
export function rangeStart(id: UsageRangeId, now: Date = new Date()): number | undefined {
  const range = USAGE_RANGES.find((candidate) => candidate.id === id)
  if (!range?.days) return undefined
  // Calendar arithmetic, because a day is not always 24 hours around a clock change.
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (range.days - 1)).getTime()
}

export function totalTokens(row: Pick<UsageTotals, 'inputTokens' | 'outputTokens'>): number {
  return row.inputTokens + row.outputTokens
}

/** Compact counts: 950, 12.4K, 3.1M. */
export function formatTokens(value: number): string {
  if (value < 1000) return String(Math.round(value))
  if (value < 1_000_000) return `${trimZero(value / 1000)}K`
  return `${trimZero(value / 1_000_000)}M`
}

function trimZero(value: number): string {
  return String(Number(value.toFixed(value >= 100 ? 0 : 1)))
}

/** Small amounts keep enough digits to be meaningful. */
export function formatCost(value: number): string {
  if (value === 0) return '$0'
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 100) return `$${value.toFixed(2)}`
  return `$${Math.round(value).toLocaleString('en-US')}`
}

/** A round upper bound for a chart axis, so ticks land on clean numbers. */
export function niceMax(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10
  return step * magnitude
}

/** Tick values for an axis that ends at a `niceMax` value, so every label is a round number. */
export function axisTicks(max: number): number[] {
  const leading = max / 10 ** Math.floor(Math.log10(max))
  const divisions = leading === 2.5 || leading === 5 ? 5 : 4
  return Array.from({ length: divisions + 1 }, (_, index) => (max / divisions) * index)
}

function addRows(rows: UsageRow[], key: string, label: string): UsageRow {
  return rows.reduce<UsageRow>(
    (sum, row) => ({
      ...sum,
      runs: sum.runs + row.runs,
      inputTokens: sum.inputTokens + row.inputTokens,
      outputTokens: sum.outputTokens + row.outputTokens,
      cachedInputTokens: sum.cachedInputTokens + row.cachedInputTokens,
      reasoningTokens: sum.reasoningTokens + row.reasoningTokens,
      cost: sum.cost + row.cost,
      unpricedRuns: sum.unpricedRuns + row.unpricedRuns
    }),
    {
      key,
      label,
      runs: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      cost: 0,
      unpricedRuns: 0
    }
  )
}

/** Long ranges group days together, because a chart cannot show hundreds of readable columns. */
export function bucketDays(days: UsageRow[], maxBuckets: number): UsageRow[] {
  if (days.length <= maxBuckets) return days
  const size = Math.ceil(days.length / maxBuckets)
  const buckets: UsageRow[] = []
  for (let start = 0; start < days.length; start += size) {
    const group = days.slice(start, start + size)
    const first = group[0]?.label ?? ''
    const last = group.at(-1)?.label ?? ''
    buckets.push(addRows(group, group[0]?.key ?? String(start), `${first} to ${last}`))
  }
  return buckets
}

/** Keeps the largest rows and folds the rest into one, so a long tail stays readable. */
export function topRows(
  rows: UsageRow[],
  limit: number,
  measure: (row: UsageRow) => number
): UsageRow[] {
  const sorted = [...rows].sort((a, b) => measure(b) - measure(a))
  if (sorted.length <= limit) return sorted
  const rest = sorted.slice(limit - 1)
  return [...sorted.slice(0, limit - 1), addRows(rest, 'other', `Other (${rest.length})`)]
}

export function formatDayKey(key: string): string {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  })
}
