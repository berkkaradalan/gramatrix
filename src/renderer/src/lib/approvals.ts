import type { ApprovalRequest } from '@shared/types'

/** The "Approve all" bar only helps when at least this many approvals wait at the same time. */
export const MIN_BATCH_SIZE = 2

/**
 * Approvals the user can still answer: shown on screen and not already answered from it.
 * An answer stays in `answering` until the host confirms it, so nothing is sent twice.
 */
export function unansweredApprovals(
  approvals: readonly ApprovalRequest[],
  answering: ReadonlySet<string>
): ApprovalRequest[] {
  return approvals.filter((request) => !answering.has(request.id))
}

/**
 * How many approvals the bar offers to answer at once, or null when the bar is hidden.
 * While a batch is in flight the bar keeps its size, so it does not jump or vanish under the click.
 */
export function batchBarCount(waiting: number, batchInFlight: number | null): number | null {
  if (batchInFlight !== null) return batchInFlight
  return waiting >= MIN_BATCH_SIZE ? waiting : null
}
