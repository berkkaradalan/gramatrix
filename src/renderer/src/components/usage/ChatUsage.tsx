import * as Popover from '@radix-ui/react-popover'
import type { ReactNode } from 'react'
import { formatCost, formatTokens, totalTokens } from '../../lib/usage'
import { invoke, useHostEvent, useQuery } from '../../state/hooks'

/** Tokens and cost of one chat, in its header. Hidden until the chat has any recorded use. */
export function ChatUsage({ chatId }: { chatId: string }): ReactNode {
  const report = useQuery(() => invoke('usage.report', { chatId }), [chatId])
  useHostEvent('usage.changed', (event) => {
    if (event.chatId === chatId) void report.reload()
  })

  const totals = report.data?.totals
  if (!totals || totals.runs === 0) return null
  const allUnpriced = totals.unpricedRuns === totals.runs

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="usage-chip" aria-label="Chat usage">
          {formatTokens(totalTokens(totals))}
          {!allUnpriced && (
            <>
              <span className="meta-separator" />
              {formatCost(totals.cost)}
            </>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover usage-popover" align="end" sideOffset={6}>
          <h3>Usage in this chat</h3>
          <dl className="usage-detail">
            <dt>Tokens in</dt>
            <dd>{formatTokens(totals.inputTokens)}</dd>
            <dt>Tokens out</dt>
            <dd>{formatTokens(totals.outputTokens)}</dd>
            <dt>Cached in</dt>
            <dd>{formatTokens(totals.cachedInputTokens)}</dd>
            <dt>Reasoning</dt>
            <dd>{formatTokens(totals.reasoningTokens)}</dd>
            <dt>Runs</dt>
            <dd>{totals.runs}</dd>
            <dt>Cost</dt>
            <dd>{allUnpriced ? 'Plan' : formatCost(totals.cost)}</dd>
          </dl>
          {totals.unpricedRuns > 0 && !allUnpriced && (
            <p className="hint">Runs on a plan are not part of the cost.</p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
