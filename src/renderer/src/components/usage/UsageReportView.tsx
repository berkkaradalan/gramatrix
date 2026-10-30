import { ChartNoAxesColumn, Info } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { ProviderId, UsageQuery, UsageReport, UsageRow } from '@shared/types'
import {
  USAGE_RANGES,
  formatCost,
  formatTokens,
  rangeStart,
  topRows,
  totalTokens,
  type UsageRangeId
} from '../../lib/usage'
import { useApp } from '../../state/app-context'
import { invoke, useHostEvent, useQuery } from '../../state/hooks'
import { ProviderLogo } from '../ProviderLogo'
import { Banner, Button, EmptyState, Segmented, Skeleton } from '../ui'
import { DailyChart, MEASURE_LABELS, type UsageMeasure } from './DailyChart'

const BREAKDOWN_LIMIT = 8

function Tile({ label, value, note }: { label: string; value: string; note?: string }): ReactNode {
  return (
    <div className="stat-tile">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {note && <p className="hint">{note}</p>}
    </div>
  )
}

function Tiles({ report }: { report: UsageReport }): ReactNode {
  const { totals } = report
  const allUnpriced = totals.runs > 0 && totals.unpricedRuns === totals.runs
  return (
    <div className="stat-tiles">
      <Tile
        label="Cost"
        value={allUnpriced ? 'Plan' : formatCost(totals.cost)}
        note={allUnpriced ? 'No per token price' : undefined}
      />
      <Tile label="Tokens in" value={formatTokens(totals.inputTokens)} />
      <Tile label="Tokens out" value={formatTokens(totals.outputTokens)} />
      <Tile label="Runs" value={String(totals.runs)} />
    </div>
  )
}

function Breakdown({
  title,
  rows,
  measure
}: {
  title: string
  rows: UsageRow[]
  measure: UsageMeasure
}): ReactNode {
  const { providers } = useApp()
  const value = (row: UsageRow): number => (measure === 'cost' ? row.cost : totalTokens(row))
  const visible = topRows(rows, BREAKDOWN_LIMIT, value)
  const largest = Math.max(...visible.map(value), 0)

  return (
    <section className="breakdown" aria-label={title}>
      <h2>{title}</h2>
      {visible.length === 0 && <p className="hint">Nothing recorded in this range.</p>}
      <ul className="list-plain">
        {visible.map((row) => {
          const provider = providers.find(({ id }) => id === (row.key as ProviderId))
          const width = largest > 0 ? (value(row) / largest) * 100 : 0
          return (
            <li key={row.key} className="breakdown-row">
              <span className="breakdown-label" title={row.label}>
                {provider && <ProviderLogo logo={provider.logo} size={13} />}
                <span>{row.label}</span>
              </span>
              <span className="breakdown-track" aria-hidden="true">
                {width > 0 && <span className="breakdown-bar" style={{ width: `${width}%` }} />}
              </span>
              <span className="breakdown-value">
                {measure === 'cost' ? formatCost(row.cost) : formatTokens(totalTokens(row))}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** The full usage report, shared by the Usage page and the project page. */
export function UsageReportView({
  query,
  showProjects = true
}: {
  query: Pick<UsageQuery, 'projectId'>
  showProjects?: boolean
}): ReactNode {
  const [range, setRange] = useState<UsageRangeId>('30d')
  const [measure, setMeasure] = useState<UsageMeasure>('tokens')
  const report = useQuery(
    () => invoke('usage.report', { ...query, from: rangeStart(range) }),
    [range, query.projectId]
  )
  useHostEvent('usage.changed', () => void report.reload())

  const data = report.data
  const unpriced = data?.totals.unpricedRuns ?? 0

  return (
    <div className="usage">
      <div className="usage-controls">
        <Segmented
          label="Range"
          value={range}
          options={USAGE_RANGES.map(({ id, label }) => ({ value: id, label }))}
          onChange={(value) => setRange(value as UsageRangeId)}
        />
        <Segmented
          label="Measure"
          value={measure}
          options={(['tokens', 'cost'] as const).map((value) => ({
            value,
            label: MEASURE_LABELS[value]
          }))}
          onChange={(value) => setMeasure(value as UsageMeasure)}
        />
      </div>

      {report.error && (
        <Banner
          tone="error"
          action={<Button onClick={() => void report.reload()}>Try again</Button>}
        >
          Could not load usage: {report.error}
        </Banner>
      )}
      {report.loading && !data && <Skeleton rows={4} />}

      {data && data.totals.runs === 0 && (
        <EmptyState icon={ChartNoAxesColumn} title="No usage in this range">
          Usage is recorded for every run from now on. Older chats have no data.
        </EmptyState>
      )}

      {data && data.totals.runs > 0 && (
        <>
          <Tiles report={data} />
          {unpriced > 0 && (
            <p className="usage-note">
              <Info size={14} aria-hidden />
              {unpriced === 1 ? '1 run' : `${unpriced} runs`} on a plan or an unpriced model. They
              are not part of the cost, because plans have no per token price.
            </p>
          )}
          <section className="chart-card" aria-label="Daily usage">
            <h2>{MEASURE_LABELS[measure]} per day</h2>
            <DailyChart days={data.byDay} measure={measure} />
          </section>
          <div className="breakdowns">
            <Breakdown title="By model" rows={data.byModel} measure={measure} />
            <Breakdown title="By provider" rows={data.byProvider} measure={measure} />
            {showProjects && (
              <Breakdown title="By project" rows={data.byProject} measure={measure} />
            )}
            <Breakdown title="By source" rows={data.bySource} measure={measure} />
          </div>
        </>
      )}
    </div>
  )
}
