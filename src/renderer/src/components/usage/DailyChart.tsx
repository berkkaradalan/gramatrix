import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { UsageRow } from '@shared/types'
import {
  axisTicks,
  bucketDays,
  formatCost,
  formatDayKey,
  formatTokens,
  niceMax,
  totalTokens
} from '../../lib/usage'

const HEIGHT = 200
const MARGIN = { top: 12, right: 8, bottom: 24, left: 44 }
const MAX_BAR_WIDTH = 14
const BAR_GAP = 2
const BAR_RADIUS = 4
const MAX_BARS = 120

export type UsageMeasure = 'tokens' | 'cost'

export const MEASURE_LABELS: Record<UsageMeasure, string> = { tokens: 'Tokens', cost: 'Cost' }

function measureValue(row: UsageRow, measure: UsageMeasure): number {
  return measure === 'cost' ? row.cost : totalTokens(row)
}

function formatValue(value: number, measure: UsageMeasure): string {
  return measure === 'cost' ? formatCost(value) : formatTokens(value)
}

/** A bar with a rounded data end and a square baseline. */
function barPath(x: number, y: number, width: number, height: number): string {
  const radius = Math.min(BAR_RADIUS, width / 2, height)
  const bottom = y + height
  return [
    `M${x},${bottom}`,
    `V${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `H${x + width - radius}`,
    `Q${x + width},${y} ${x + width},${y + radius}`,
    `V${bottom}`,
    'Z'
  ].join('')
}

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const element = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const node = element.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [element, width]
}

/** One measure per day on one axis. The measure control switches it, so scales never mix. */
export function DailyChart({
  days,
  measure
}: {
  days: UsageRow[]
  measure: UsageMeasure
}): ReactNode {
  const [container, width] = useWidth()
  const [hovered, setHovered] = useState<number | null>(null)
  const rows = useMemo(() => bucketDays(days, MAX_BARS), [days])

  const values = rows.map((row) => measureValue(row, measure))
  const maxValue = niceMax(Math.max(...values, 0))
  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 0)
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
  const band = rows.length > 0 ? plotWidth / rows.length : 0
  const barWidth = Math.max(Math.min(band - BAR_GAP, MAX_BAR_WIDTH), 1)
  const y = (value: number): number => MARGIN.top + plotHeight * (1 - value / maxValue)
  const ticks = axisTicks(maxValue)
  const hoveredRow = hovered === null ? undefined : rows[hovered]
  const labelStep = Math.max(Math.ceil(rows.length / 6), 1)
  const dayLabel = (row: UsageRow): string =>
    row.label.includes(' to ') ? row.label : formatDayKey(row.key)

  return (
    <div className="chart" ref={container}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${MEASURE_LABELS[measure]} per day`}
          onMouseLeave={() => setHovered(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className="chart-grid"
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text className="chart-tick" x={MARGIN.left - 8} y={y(tick) + 4} textAnchor="end">
                {formatValue(tick, measure)}
              </text>
            </g>
          ))}
          {rows.map((row, index) => {
            const value = values[index] ?? 0
            const barHeight = value > 0 ? Math.max(plotHeight * (value / maxValue), 2) : 0
            const x = MARGIN.left + band * index + (band - barWidth) / 2
            const dimmed = hovered !== null && hovered !== index
            return (
              <g key={row.key}>
                {barHeight > 0 && (
                  <path
                    className={dimmed ? 'chart-bar chart-bar-dim' : 'chart-bar'}
                    d={barPath(x, MARGIN.top + plotHeight - barHeight, barWidth, barHeight)}
                  />
                )}
                {/* The hit area is the whole band, so small bars are easy to point at. */}
                <rect
                  className="chart-hit"
                  x={MARGIN.left + band * index}
                  y={MARGIN.top}
                  width={band}
                  height={plotHeight}
                  onMouseEnter={() => setHovered(index)}
                />
                {index % labelStep === 0 && (
                  <text
                    className="chart-tick"
                    x={MARGIN.left + band * index + band / 2}
                    y={HEIGHT - 6}
                    textAnchor="middle"
                  >
                    {formatDayKey(row.key)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {hoveredRow && hovered !== null && (
        <div
          className="chart-tooltip"
          style={{
            left: Math.min(MARGIN.left + band * (hovered + 0.5), width - 180),
            top: MARGIN.top
          }}
        >
          <strong>{dayLabel(hoveredRow)}</strong>
          <dl>
            <dt>Tokens in</dt>
            <dd>{formatTokens(hoveredRow.inputTokens)}</dd>
            <dt>Tokens out</dt>
            <dd>{formatTokens(hoveredRow.outputTokens)}</dd>
            <dt>Cost</dt>
            <dd>{formatCost(hoveredRow.cost)}</dd>
            <dt>Runs</dt>
            <dd>{hoveredRow.runs}</dd>
          </dl>
        </div>
      )}
      <table className="visually-hidden">
        <caption>{MEASURE_LABELS[measure]} per day</caption>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key}>
              <th scope="row">{dayLabel(row)}</th>
              <td>{formatValue(values[index] ?? 0, measure)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
