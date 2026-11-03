import type {
  ApprovalRequest,
  MessagePart,
  ProviderMetadata,
  ReasoningPart,
  RunEvent,
  TextPart,
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
  /** The text or reasoning block the provider is streaming, from its start event to its end. */
  private openBlock: { type: 'text' | 'reasoning'; part: TextPart | ReasoningPart | null } | null =
    null
  /** Provider data for tool calls that the SDK announced before the tool started running. */
  private readonly pendingToolMetadata = new Map<string, ProviderMetadata>()

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

  /** A new text or reasoning block starts. It becomes its own part, with its own provider data. */
  blockStarted(type: 'text' | 'reasoning'): void {
    this.openBlock = { type, part: null }
  }

  /**
   * Keeps the provider data of a finished block. A block without text, such as encrypted reasoning,
   * is still kept, because some providers need it back on the next request.
   */
  blockEnded(type: 'text' | 'reasoning', providerMetadata: ProviderMetadata | undefined): void {
    const block = this.openBlock?.type === type ? this.openBlock : null
    this.openBlock = null
    if (!hasData(providerMetadata)) return
    if (block?.part) {
      block.part.providerMetadata = providerMetadata
    } else if (type === 'reasoning') {
      this.parts.push({ type, text: '', providerMetadata })
    }
  }

  /** Provider data of a tool call, which can arrive before or after the tool starts running. */
  toolCallMetadata(toolCallId: string, providerMetadata: ProviderMetadata | undefined): void {
    if (!hasData(providerMetadata)) return
    const part = this.findTool(toolCallId)
    if (part) part.providerMetadata = providerMetadata
    else this.pendingToolMetadata.set(toolCallId, providerMetadata)
  }

  toolStarted(input: Pick<ToolCallPart, 'toolCallId' | 'toolName' | 'input' | 'subagentId'>): void {
    const providerMetadata = this.pendingToolMetadata.get(input.toolCallId)
    this.pendingToolMetadata.delete(input.toolCallId)
    const part: ToolCallPart = {
      ...input,
      type: 'tool-call',
      state: 'running',
      ...(providerMetadata ? { providerMetadata } : {})
    }
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
    const block = this.openBlock?.type === type ? this.openBlock : null
    if (block?.part) {
      block.part.text += delta
      return
    }
    const last = this.parts.at(-1)
    // Without start events, as from older providers, consecutive deltas still join one part.
    if (!block && last?.type === type) {
      last.text += delta
      return
    }
    const part = { type, text: delta }
    this.parts.push(part)
    if (block) block.part = part
  }
}

function hasData(metadata: ProviderMetadata | undefined): metadata is ProviderMetadata {
  return metadata !== undefined && Object.keys(metadata).length > 0
}
