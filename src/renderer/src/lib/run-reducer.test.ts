import { describe, expect, it } from 'vitest'
import type { ApprovalRequest, RunEvent, ToolCallPart } from '@shared/types'
import {
  IDLE_RUN,
  applyRunEvent,
  describeToolInput,
  groupParts,
  settleRun,
  type RunState
} from './run-reducer'

const ids = { runId: 'r1', chatId: 'c1' }

function replay(events: RunEvent[], from: RunState = IDLE_RUN): RunState {
  return events.reduce(applyRunEvent, from)
}

function toolCall(id: string, overrides: Partial<ToolCallPart> = {}): ToolCallPart {
  return {
    type: 'tool-call',
    toolCallId: id,
    toolName: 'read_file',
    input: { path: 'a.ts' },
    state: 'running',
    ...overrides
  }
}

const approval: ApprovalRequest = {
  id: 'a1',
  chatId: 'c1',
  toolCallId: 't1',
  toolName: 'shell',
  summary: 'Run npm test',
  input: { command: 'npm test' }
}

describe('applyRunEvent', () => {
  it('joins consecutive deltas into one part', () => {
    const state = replay([
      { type: 'started', ...ids, messageId: 'm1' },
      { type: 'text-delta', ...ids, delta: 'Hel' },
      { type: 'text-delta', ...ids, delta: 'lo' }
    ])
    expect(state.parts).toEqual([{ type: 'text', text: 'Hello' }])
    expect(state.status).toBe('running')
  })

  it('starts a new part when the kind changes', () => {
    const state = replay([
      { type: 'reasoning-delta', ...ids, delta: 'think' },
      { type: 'text-delta', ...ids, delta: 'say' },
      { type: 'tool-call', ...ids, part: toolCall('t1') },
      { type: 'text-delta', ...ids, delta: 'more' }
    ])
    expect(state.parts.map((part) => part.type)).toEqual(['reasoning', 'text', 'tool-call', 'text'])
  })

  it('updates a tool call in place', () => {
    const state = replay([
      { type: 'tool-call', ...ids, part: toolCall('t1') },
      { type: 'tool-update', ...ids, part: toolCall('t1', { state: 'completed', output: 'ok' }) }
    ])
    expect(state.parts).toEqual([toolCall('t1', { state: 'completed', output: 'ok' })])
  })

  it('tracks approvals without duplicates and removes resolved ones', () => {
    const requested: RunEvent = { type: 'approval-requested', ...ids, request: approval }
    const pending = replay([requested, requested])
    expect(pending.approvals).toEqual([approval])
    const resolved = applyRunEvent(pending, {
      type: 'approval-resolved',
      ...ids,
      requestId: 'a1'
    })
    expect(resolved.approvals).toEqual([])
  })

  it('updates subagent status', () => {
    const state = replay([
      { type: 'subagent', ...ids, subagentId: 's1', name: 'tests', status: 'started' },
      { type: 'subagent', ...ids, subagentId: 's1', name: 'tests', status: 'completed' }
    ])
    expect(state.subagents).toEqual([{ id: 's1', name: 'tests', status: 'completed' }])
  })

  it('keeps the error of a failed run and clears approvals', () => {
    const state = replay([
      { type: 'approval-requested', ...ids, request: approval },
      { type: 'failed', ...ids, error: 'Rate limited' }
    ])
    expect(state.status).toBe('failed')
    expect(state.error).toBe('Rate limited')
    expect(state.approvals).toEqual([])
  })

  it('recovers when a run is observed from the middle', () => {
    const state = applyRunEvent(IDLE_RUN, { type: 'text-delta', ...ids, delta: 'late' })
    expect(state.status).toBe('running')
    expect(state.runId).toBe('r1')
  })

  it('remembers which message the run is writing', () => {
    const state = applyRunEvent(IDLE_RUN, { type: 'started', ...ids, messageId: 'm1' })
    expect(state.messageId).toBe('m1')
    expect(settleRun(applyRunEvent(state, { type: 'finished', ...ids })).messageId).toBeNull()
  })

  it('keeps approvals loaded before a run announces itself', () => {
    const seeded: RunState = { ...IDLE_RUN, approvals: [approval] }
    const state = applyRunEvent(seeded, { type: 'started', ...ids, messageId: 'm1' })
    expect(state.approvals).toEqual([approval])
  })
})

describe('settleRun', () => {
  it('clears live parts after a finished run', () => {
    const finished = replay([
      { type: 'text-delta', ...ids, delta: 'done' },
      { type: 'finished', ...ids }
    ])
    expect(settleRun(finished)).toEqual(IDLE_RUN)
  })

  it('keeps the error after a failed run', () => {
    const failed = replay([{ type: 'failed', ...ids, error: 'Bad key' }])
    expect(settleRun(failed)).toMatchObject({ status: 'failed', error: 'Bad key', parts: [] })
  })

  it('leaves a running state alone', () => {
    const running = replay([{ type: 'text-delta', ...ids, delta: 'x' }])
    expect(settleRun(running)).toBe(running)
  })
})

describe('groupParts', () => {
  it('nests subagent calls at the place of the first call', () => {
    const blocks = groupParts(
      [
        { type: 'text', text: 'before' },
        toolCall('t1', { subagentId: 's1' }),
        { type: 'text', text: 'after' },
        toolCall('t2', { subagentId: 's1' })
      ],
      [{ id: 's1', name: 'tests', status: 'started' }]
    )
    expect(blocks.map((block) => block.kind)).toEqual(['part', 'subagent', 'part'])
    const group = blocks[1]
    expect(group?.kind === 'subagent' && group.calls.map((call) => call.toolCallId)).toEqual([
      't1',
      't2'
    ])
  })

  it('lists idle subagents last', () => {
    const blocks = groupParts(
      [{ type: 'text', text: 'hi' }],
      [{ id: 's1', name: 'tests', status: 'started' }]
    )
    expect(blocks.map((block) => block.kind)).toEqual(['part', 'subagent'])
  })

  it('names subagents from saved messages generically', () => {
    const [block] = groupParts([toolCall('t1', { subagentId: 's1' })])
    expect(block?.kind === 'subagent' && block.subagent.name).toBe('Subagent')
  })
})

describe('describeToolInput', () => {
  it('prefers the most descriptive field', () => {
    expect(describeToolInput({ command: 'ls', path: 'x' })).toBe('ls')
    expect(describeToolInput({ path: 'src/a.ts' })).toBe('src/a.ts')
  })

  it('returns nothing for unknown shapes', () => {
    expect(describeToolInput({ other: 1 })).toBe('')
    expect(describeToolInput(null)).toBe('')
  })
})
