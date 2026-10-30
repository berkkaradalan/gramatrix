import { describe, expect, it } from 'vitest'
import type { UsageRow } from '@shared/types'
import {
  axisTicks,
  bucketDays,
  formatCost,
  formatDayKey,
  formatTokens,
  niceMax,
  rangeStart,
  topRows,
  totalTokens
} from './usage'

function row(key: string, inputTokens: number, cost = 0): UsageRow {
  return {
    key,
    label: key,
    runs: 1,
    inputTokens,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    cost,
    unpricedRuns: 0
  }
}

describe('formatTokens', () => {
  it('stays compact', () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(12_400)).toBe('12.4K')
    expect(formatTokens(250_000)).toBe('250K')
    expect(formatTokens(3_100_000)).toBe('3.1M')
  })
})

describe('formatCost', () => {
  it('keeps small amounts meaningful', () => {
    expect(formatCost(0)).toBe('$0')
    expect(formatCost(0.0042)).toBe('$0.0042')
    expect(formatCost(1.5)).toBe('$1.50')
    expect(formatCost(1234.5)).toBe('$1,235')
  })
})

describe('niceMax', () => {
  it('rounds up to a clean number', () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(7)).toBe(10)
    expect(niceMax(120)).toBe(200)
    expect(niceMax(2300)).toBe(2500)
    expect(niceMax(0.4)).toBe(0.5)
  })
})

describe('axisTicks', () => {
  it('lands on round numbers', () => {
    expect(axisTicks(250_000)).toEqual([0, 50_000, 100_000, 150_000, 200_000, 250_000])
    expect(axisTicks(200)).toEqual([0, 50, 100, 150, 200])
    expect(axisTicks(5)).toEqual([0, 1, 2, 3, 4, 5])
  })
})

describe('rangeStart', () => {
  const now = new Date(2026, 9, 30, 15, 30)

  it('counts today as the last day of the range', () => {
    expect(rangeStart('7d', now)).toBe(new Date(2026, 9, 24).getTime())
  })

  it('has no start for all time', () => {
    expect(rangeStart('all', now)).toBeUndefined()
  })
})

describe('bucketDays', () => {
  const days = Array.from({ length: 10 }, (_, index) => row(`d${index}`, 10, 1))

  it('leaves short ranges alone', () => {
    expect(bucketDays(days, 10)).toBe(days)
  })

  it('groups long ranges and keeps every token', () => {
    const buckets = bucketDays(days, 4)
    expect(buckets).toHaveLength(4)
    expect(buckets.reduce((sum, bucket) => sum + totalTokens(bucket), 0)).toBe(100)
    expect(buckets[0]?.label).toBe('d0 to d2')
  })
})

describe('topRows', () => {
  const rows = [row('a', 5), row('b', 30), row('c', 20), row('d', 10)]

  it('sorts by the measure', () => {
    expect(topRows(rows, 4, totalTokens).map(({ key }) => key)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('folds the tail into Other', () => {
    const top = topRows(rows, 3, totalTokens)
    expect(top.map(({ key }) => key)).toEqual(['b', 'c', 'other'])
    expect(top[2]?.label).toBe('Other (2)')
    expect(top[2]?.inputTokens).toBe(15)
  })
})

describe('formatDayKey', () => {
  it('reads as a short date', () => {
    expect(formatDayKey('2026-10-03')).toBe('Oct 3')
  })
})
