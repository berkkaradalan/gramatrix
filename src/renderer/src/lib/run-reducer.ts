import type {
  ApprovalRequest,
  MessagePart,
  ReasoningPart,
  RunEvent,
  TextPart,
  ToolCallPart
} from '@shared/types'

export type RunStatus = 'idle' | 'running' | 'finished' | 'cancelled' | 'failed'

export interface SubagentActivity {
  id: string
  name: string
  status: 'started' | 'completed' | 'failed'
}

/** Live view of the latest run in one chat. Persisted messages replace it when the run ends. */
export interface RunState {
  runId: string | null
  /** The assistant message being written. The host saves it as it goes, so the view hides it. */
  messageId: string | null
  status: RunStatus
  parts: MessagePart[]
  subagents: SubagentActivity[]
  approvals: ApprovalRequest[]
  error: string | null
}

export const IDLE_RUN: RunState = {
  runId: null,
  messageId: null,
  status: 'idle',
  parts: [],
  subagents: [],
  approvals: [],
  error: null
}

function appendText(
  parts: MessagePart[],
  type: (TextPart | ReasoningPart)['type'],
  delta: string
): MessagePart[] {
  const last = parts.at(-1)
  if (last?.type === type) return [...parts.slice(0, -1), { ...last, text: last.text + delta }]
  return [...parts, { type, text: delta }]
}

function upsertToolCall(parts: MessagePart[], part: ToolCallPart): MessagePart[] {
  const index = parts.findIndex(
    (candidate) => candidate.type === 'tool-call' && candidate.toolCallId === part.toolCallId
  )
  if (index === -1) return [...parts, part]
  return parts.map((candidate, position) => (position === index ? part : candidate))
}

function upsertSubagent(
  subagents: SubagentActivity[],
  activity: SubagentActivity
): SubagentActivity[] {
  const known = subagents.some((subagent) => subagent.id === activity.id)
  if (!known) return [...subagents, activity]
  return subagents.map((subagent) => (subagent.id === activity.id ? activity : subagent))
}

export function applyRunEvent(state: RunState, event: RunEvent): RunState {
  // Events can arrive without `started` when the window reloads during a run.
  const running: RunState = { ...state, runId: event.runId, status: 'running' }

  switch (event.type) {
    case 'started':
      return {
        ...IDLE_RUN,
        runId: event.runId,
        messageId: event.messageId,
        status: 'running',
        approvals: state.approvals
      }
    case 'text-delta':
      return { ...running, parts: appendText(state.parts, 'text', event.delta) }
    case 'reasoning-delta':
      return { ...running, parts: appendText(state.parts, 'reasoning', event.delta) }
    case 'tool-call':
    case 'tool-update':
      return { ...running, parts: upsertToolCall(state.parts, event.part) }
    case 'subagent':
      return {
        ...running,
        subagents: upsertSubagent(state.subagents, {
          id: event.subagentId,
          name: event.name,
          status: event.status
        })
      }
    case 'approval-requested':
      if (state.approvals.some((approval) => approval.id === event.request.id)) return running
      return { ...running, approvals: [...state.approvals, event.request] }
    case 'approval-resolved':
      return {
        ...running,
        approvals: state.approvals.filter((approval) => approval.id !== event.requestId)
      }
    case 'finished':
      return { ...state, runId: event.runId, status: 'finished', approvals: [] }
    case 'cancelled':
      return { ...state, runId: event.runId, status: 'cancelled', approvals: [] }
    case 'failed':
      return { ...state, runId: event.runId, status: 'failed', approvals: [], error: event.error }
  }
}

/** Drops live parts once the persisted messages have been loaded. Keeps any error on screen. */
export function settleRun(state: RunState): RunState {
  if (state.status === 'running') return state
  return { ...IDLE_RUN, status: state.status === 'failed' ? 'failed' : 'idle', error: state.error }
}

export function isTerminal(status: RunStatus): boolean {
  return status === 'finished' || status === 'cancelled' || status === 'failed'
}

export type PartBlock =
  | { kind: 'part'; key: string; part: MessagePart }
  | {
      kind: 'subagent'
      key: string
      subagent: SubagentActivity
      calls: ToolCallPart[]
    }

/**
 * Groups tool calls made inside a subagent under one block, placed where the subagent
 * first acted. Subagents that have not made a call yet come last.
 */
export function groupParts(parts: MessagePart[], subagents: SubagentActivity[] = []): PartBlock[] {
  const blocks: PartBlock[] = []
  const groups = new Map<string, Extract<PartBlock, { kind: 'subagent' }>>()

  parts.forEach((part, index) => {
    const subagentId = part.type === 'tool-call' ? part.subagentId : undefined
    if (part.type !== 'tool-call' || subagentId === undefined) {
      const key = part.type === 'tool-call' ? part.toolCallId : `${part.type}-${index}`
      blocks.push({ kind: 'part', key, part })
      return
    }
    let group = groups.get(subagentId)
    if (!group) {
      const subagent = subagents.find((candidate) => candidate.id === subagentId) ?? {
        id: subagentId,
        name: 'Subagent',
        status: 'completed' as const
      }
      group = { kind: 'subagent', key: `subagent-${subagentId}`, subagent, calls: [] }
      groups.set(subagentId, group)
      blocks.push(group)
    }
    group.calls.push(part)
  })

  for (const subagent of subagents) {
    if (groups.has(subagent.id)) continue
    blocks.push({ kind: 'subagent', key: `subagent-${subagent.id}`, subagent, calls: [] })
  }
  return blocks
}

/** Short one line hint of what a tool call acts on, for its collapsed row. */
export function describeToolInput(input: unknown): string {
  if (typeof input === 'string') return input
  if (typeof input !== 'object' || input === null) return ''
  const record = input as Record<string, unknown>
  for (const key of ['command', 'path', 'file', 'filePath', 'pattern', 'query', 'name', 'task']) {
    const value = record[key]
    if (typeof value === 'string') return value
  }
  return ''
}
