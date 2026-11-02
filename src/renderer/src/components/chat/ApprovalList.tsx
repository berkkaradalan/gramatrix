import { CheckCheck, X } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import type { ApprovalRequest } from '@shared/types'
import { batchBarCount, unansweredApprovals } from '../../lib/approvals'
import { errorMessage } from '../../lib/format'
import { invoke } from '../../state/hooks'
import { toast } from '../../state/toasts'
import { Button } from '../ui'
import { ApprovalCard } from './ApprovalCard'

/**
 * The approvals waiting in one chat. Each card answers its own request. When two or more wait at
 * the same time, a bar above them answers all of them at once, one `agent.resolveApproval` call
 * per request, so the host sees the same calls as from the cards.
 */
export function ApprovalList({ approvals }: { approvals: ApprovalRequest[] }): ReactNode {
  // Ids whose answer was sent and not yet confirmed by `approval-resolved`. The refs guard
  // against a second click before React renders; the state drives the disabled buttons.
  const sent = useRef(new Set<string>())
  const batchInFlight = useRef(false)
  const [answering, setAnswering] = useState<ReadonlySet<string>>(new Set())
  const [batchSize, setBatchSize] = useState<number | null>(null)

  const waiting = unansweredApprovals(approvals, answering)
  const barCount = batchBarCount(waiting.length, batchSize)

  const mark = (ids: string[], isSent: boolean): void => {
    for (const id of ids) {
      if (isSent) sent.current.add(id)
      else sent.current.delete(id)
    }
    setAnswering(new Set(sent.current))
  }

  const answer = async (ids: string[], approved: boolean): Promise<void> => {
    const fresh = ids.filter((id) => !sent.current.has(id))
    if (fresh.length === 0) return
    mark(fresh, true)
    const results = await Promise.allSettled(
      fresh.map((requestId) => invoke('agent.resolveApproval', { requestId, approved }))
    )
    const failed = fresh.filter((_, index) => results[index]?.status === 'rejected')
    if (failed.length === 0) return
    // Let the user try again. A request that is gone is removed by its resolved event anyway.
    mark(failed, false)
    const reason = results.find((result) => result.status === 'rejected')?.reason
    toast.error(errorMessage(reason))
  }

  const answerAll = async (approved: boolean): Promise<void> => {
    // Only the approvals on screen at the moment of the click. One that arrives while these
    // calls are in flight gets its own card and is never answered by this click.
    const ids = waiting.map(({ id }) => id).filter((id) => !sent.current.has(id))
    if (batchInFlight.current || ids.length === 0) return
    batchInFlight.current = true
    setBatchSize(ids.length)
    try {
      await answer(ids, approved)
    } finally {
      batchInFlight.current = false
      setBatchSize(null)
    }
  }

  if (approvals.length === 0) return null

  return (
    <>
      {barCount !== null && (
        <div className="approval-batch" role="group" aria-label="Answer all approvals">
          <p>{barCount === 1 ? '1 action is' : `${barCount} actions are`} waiting for approval.</p>
          <div className="row">
            <Button
              variant="primary"
              icon={CheckCheck}
              disabled={batchSize !== null}
              onClick={() => void answerAll(true)}
            >
              Approve all ({barCount})
            </Button>
            <Button icon={X} disabled={batchSize !== null} onClick={() => void answerAll(false)}>
              Deny all
            </Button>
          </div>
        </div>
      )}
      {approvals.map((request) => (
        <ApprovalCard
          key={request.id}
          request={request}
          answering={answering.has(request.id)}
          onAnswer={(approved) => void answer([request.id], approved)}
        />
      ))}
    </>
  )
}
