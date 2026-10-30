import type {
  ApprovalRequest,
  MessagePart,
  RunEvent,
  ToolCallPart,
  ToolCallState
} from '@shared/types'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type RunEventBody = DistributiveOmit<RunEvent, 'runId' | 'chatId'>

export interface RunRecorderOptions {
  emit(event: RunEventBody): void
  save(parts: MessagePart[]): void
}

/** Builds the assistant message of a run, reporting and saving it as it grows. */
export class RunRecorder {
  private readonly parts: MessagePart[] = []
  private closed = false

  constructor(private readonly options: RunRecorderOptions) {}

  /**
   * Call this before the final run event. A killed command can settle after the stream ended,
   * and an event after the final one would make the interface show the run as active again.
   * Late changes are still saved.
   */
  close(): void {
    this.closed = true
  }

  textDelta(delta: string): void {
    this.appendText('text', delta)
    this.emit({ type: 'text-delta', delta })
  }

  reasoningDelta(delta: string): void {
    this.appendText('reasoning', delta)
    this.emit({ type: 'reasoning-delta', delta })
  }

  toolStarted(input: Pick<ToolCallPart, 'toolCallId' | 'toolName' | 'input' | 'subagentId'>): void {
    const part: ToolCallPart = { ...input, type: 'tool-call', state: 'running' }
    this.parts.push(part)
    this.emit({ type: 'tool-call', part: { ...part } })
    this.flush()
  }

  toolUpdated(toolCallId: string, state: ToolCallState, output?: unknown): void {
    const part = this.findTool(toolCallId)
    if (!part) return
    part.state = state
    if (output !== undefined) part.output = output
    this.emit({ type: 'tool-update', part: { ...part } })
    this.flush()
  }

  /** Records a call the SDK rejected before running it, such as one with invalid input. */
  toolRejected(toolCallId: string, toolName: string, input: unknown, error: string): void {
    if (this.findTool(toolCallId)) return
    this.toolStarted({ toolCallId, toolName, input })
    this.toolUpdated(toolCallId, 'failed', error)
  }

  emitApprovalRequested(request: ApprovalRequest): void {
    this.emit({ type: 'approval-requested', request })
  }

  emitApprovalResolved(requestId: string): void {
    this.emit({ type: 'approval-resolved', requestId })
  }

  subagent(subagentId: string, name: string, status: 'started' | 'completed' | 'failed'): void {
    this.emit({ type: 'subagent', subagentId, name, status })
  }

  flush(): void {
    if (this.parts.length > 0) this.options.save(this.parts)
  }

  /** Text written after the last top level tool call, which is the final answer. */
  finalText(): string {
    const trailing: string[] = []
    for (const part of [...this.parts].reverse()) {
      if (part.type === 'tool-call' && !part.subagentId) break
      if (part.type === 'text') trailing.unshift(part.text)
    }
    return trailing.join('')
  }

  private emit(event: RunEventBody): void {
    if (!this.closed) this.options.emit(event)
  }

  private findTool(toolCallId: string): ToolCallPart | undefined {
    return this.parts.find(
      (part): part is ToolCallPart => part.type === 'tool-call' && part.toolCallId === toolCallId
    )
  }

  private appendText(type: 'text' | 'reasoning', delta: string): void {
    const last = this.parts.at(-1)
    if (last?.type === type) last.text += delta
    else this.parts.push({ type, text: delta })
  }
}
