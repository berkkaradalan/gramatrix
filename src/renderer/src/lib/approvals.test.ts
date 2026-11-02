import { describe, expect, it } from 'vitest'
import type { ApprovalRequest } from '@shared/types'
import { batchBarCount, unansweredApprovals } from './approvals'

function request(id: string): ApprovalRequest {
  return {
    id,
    chatId: 'c1',
    toolCallId: `t-${id}`,
    toolName: 'run_command',
    summary: 'Run npm test',
    input: { command: 'npm test' }
  }
}

describe('unansweredApprovals', () => {
  it('keeps every approval when nothing was answered yet', () => {
    const approvals = [request('a1'), request('a2')]
    expect(unansweredApprovals(approvals, new Set())).toEqual(approvals)
  })

  it('leaves out approvals whose answer is already on its way', () => {
    const approvals = [request('a1'), request('a2'), request('a3')]
    const ids = unansweredApprovals(approvals, new Set(['a2'])).map(({ id }) => id)
    expect(ids).toEqual(['a1', 'a3'])
  })

  it('ignores answers for approvals that are no longer shown', () => {
    const ids = unansweredApprovals([request('a4')], new Set(['a1'])).map(({ id }) => id)
    expect(ids).toEqual(['a4'])
  })
})

describe('batchBarCount', () => {
  it('hides the bar for zero or one waiting approval', () => {
    expect(batchBarCount(0, null)).toBeNull()
    expect(batchBarCount(1, null)).toBeNull()
  })

  it('offers every waiting approval from two up', () => {
    expect(batchBarCount(2, null)).toBe(2)
    expect(batchBarCount(5, null)).toBe(5)
  })

  it('keeps the size of a batch in flight, even when new approvals arrive', () => {
    expect(batchBarCount(0, 3)).toBe(3)
    expect(batchBarCount(1, 3)).toBe(3)
  })
})
