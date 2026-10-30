import { Bot, Brain, Check, ChevronRight, LoaderCircle, Slash, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { MessagePart, ToolCallPart, ToolCallState } from '@shared/types'
import { formatJson } from '../../lib/format'
import { languageFromPath } from '../../lib/languages'
import {
  describeToolInput,
  groupParts,
  type PartBlock,
  type SubagentActivity
} from '../../lib/run-reducer'
import { CodeView } from '../code/CodeView'
import { DiffView } from './DiffView'
import { Markdown } from './Markdown'
import { inputString, isEditInput, toolMeta } from './tool-meta'

function StateIcon({ state }: { state: ToolCallState }): ReactNode {
  switch (state) {
    case 'running':
    case 'awaiting-approval':
      return <LoaderCircle className="spin" size={13} aria-label="Running" />
    case 'completed':
      return <Check className="tool-ok" size={13} aria-label="Completed" />
    case 'failed':
      return <X className="tool-failed" size={13} aria-label="Failed" />
    case 'denied':
      return <Slash className="tool-failed" size={13} aria-label="Denied" />
  }
}

function ToolDetails({ part }: { part: ToolCallPart }): ReactNode {
  const command = inputString(part.input, 'command')
  const path = inputString(part.input, 'path')
  const language = languageFromPath(path) ?? undefined
  const content = part.toolName === 'write_file' ? inputString(part.input, 'content') : undefined
  // A file read shows its content, which is worth coloring. Other output is logs and prose.
  const outputLanguage = part.toolName === 'read_file' ? language : undefined
  return (
    <div className="tool-body">
      {isEditInput(part.input) ? (
        <DiffView before={part.input.oldText} after={part.input.newText} language={language} />
      ) : content !== undefined ? (
        <CodeView code={content} language={language} />
      ) : command !== undefined ? (
        <CodeView code={command} language="bash" numbered={false} />
      ) : part.toolName !== 'read_file' ? (
        <CodeView code={formatJson(part.input)} language="json" numbered={false} />
      ) : null}
      {part.output !== undefined && (
        <CodeView code={formatJson(part.output)} language={outputLanguage} />
      )}
    </div>
  )
}

function ToolCall({ part }: { part: ToolCallPart }): ReactNode {
  const { icon: Icon, label } = toolMeta(part.toolName)
  return (
    <details className="tool">
      <summary>
        <Icon size={14} aria-hidden />
        <span className="tool-label">{label}</span>
        <span className="tool-hint">{describeToolInput(part.input)}</span>
        <StateIcon state={part.state} />
        <ChevronRight className="tool-chevron" size={13} aria-hidden />
      </summary>
      <ToolDetails part={part} />
    </details>
  )
}

function Subagent({ block }: { block: Extract<PartBlock, { kind: 'subagent' }> }): ReactNode {
  const { subagent, calls } = block
  const state: ToolCallState =
    subagent.status === 'started'
      ? 'running'
      : subagent.status === 'failed'
        ? 'failed'
        : 'completed'
  return (
    <details className="tool subagent" open={subagent.status === 'started'}>
      <summary>
        <Bot size={14} aria-hidden />
        <span className="tool-label">{subagent.name}</span>
        <span className="tool-hint">
          {calls.length === 1 ? '1 action' : `${calls.length} actions`}
        </span>
        <StateIcon state={state} />
        <ChevronRight className="tool-chevron" size={13} aria-hidden />
      </summary>
      <div className="subagent-calls">
        {calls.map((call) => (
          <ToolCall key={call.toolCallId} part={call} />
        ))}
      </div>
    </details>
  )
}

function Part({ part }: { part: MessagePart }): ReactNode {
  switch (part.type) {
    case 'text':
      return <Markdown text={part.text} />
    case 'reasoning':
      return (
        <details className="tool reasoning">
          <summary>
            <Brain size={14} aria-hidden />
            <span className="tool-label">Thinking</span>
            <span className="tool-hint" />
            <ChevronRight className="tool-chevron" size={13} aria-hidden />
          </summary>
          <p>{part.text}</p>
        </details>
      )
    case 'tool-call':
      return <ToolCall part={part} />
  }
}

export function MessageParts({
  parts,
  subagents
}: {
  parts: MessagePart[]
  subagents?: SubagentActivity[]
}): ReactNode {
  return groupParts(parts, subagents).map((block) =>
    block.kind === 'part' ? (
      <Part key={block.key} part={block.part} />
    ) : (
      <Subagent key={block.key} block={block} />
    )
  )
}
