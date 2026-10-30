import { randomUUID } from 'node:crypto'
import { ToolLoopAgent, stepCountIs, tool, type LanguageModel, type ToolSet } from 'ai'
import { z } from 'zod'
import type { PermissionMode } from '@shared/types'
import type { CommandRegistry } from './commands'
import { subagentInstructions } from './instructions'
import { decidePermission, type ApprovalBroker } from './permissions'
import type { RunRecorder } from './run-recorder'
import type { StepUsage } from '../services/usage'
import { BASE_TOOLS, defineTool, type AgentTool } from './tools'

/** A top level agent is depth 0, so two levels of subagents can exist below it. */
export const MAX_SUBAGENT_DEPTH = 2
export const MAX_SUBAGENT_STEPS = 20

const SPAWN_TOOL_NAME = 'spawn_subagent'

/** What every tool call in one run shares, including calls made by its subagents. */
export interface RunScope {
  chatId: string
  root: string
  /** Read for every tool call, so lowering the mode applies to a run already in progress. */
  permissionMode(): PermissionMode
  /** False when nobody can answer an approval prompt, so prompts become denials. */
  interactive: boolean
  signal: AbortSignal
  model: LanguageModel
  recorder: RunRecorder
  approvals: ApprovalBroker
  commands: CommandRegistry
  /** Called after every model call of a subagent. */
  recordSubagentStep(step: StepUsage): void
}

async function isAllowed(
  scope: RunScope,
  agentTool: AgentTool,
  input: unknown,
  toolCallId: string
): Promise<boolean> {
  const decision = decidePermission(scope.permissionMode(), agentTool.risk)
  if (decision !== 'ask') return decision === 'allow'
  if (!scope.interactive) return false

  scope.recorder.toolUpdated(toolCallId, 'awaiting-approval')
  const { recorder, chatId } = scope
  const approved = await scope.approvals.request(
    { chatId, toolCallId, toolName: agentTool.name, summary: agentTool.summarize(input), input },
    scope.signal,
    (request) => recorder.emitApprovalRequested(request),
    (requestId) => recorder.emitApprovalResolved(requestId)
  )
  // The mode may have been lowered while the prompt was open.
  if (!approved || decidePermission(scope.permissionMode(), agentTool.risk) === 'deny') return false
  recorder.toolUpdated(toolCallId, 'running')
  return true
}

/**
 * Every tool call goes through here. The check runs inside `execute` rather than through
 * the SDK approval flow because that flow is not available to subagent tools.
 */
async function runGuarded(
  scope: RunScope,
  agentTool: AgentTool,
  input: unknown,
  toolCallId: string,
  subagentId: string | undefined
): Promise<string> {
  const { recorder, signal } = scope
  recorder.toolStarted({ toolCallId, toolName: agentTool.name, input, subagentId })

  if (!(await isAllowed(scope, agentTool, input, toolCallId))) {
    const reason = signal.aborted
      ? 'Cancelled.'
      : `Permission denied in ${scope.permissionMode()} mode: ${agentTool.summarize(input)}`
    recorder.toolUpdated(toolCallId, 'denied', reason)
    signal.throwIfAborted()
    return reason
  }

  try {
    const output = await agentTool.run(input, {
      root: scope.root,
      signal,
      commands: scope.commands
    })
    recorder.toolUpdated(toolCallId, 'completed', output)
    return output
  } catch (error) {
    const message = `Error: ${error instanceof Error ? error.message : String(error)}`
    recorder.toolUpdated(toolCallId, 'failed', message)
    // A failed tool is something the model can react to. A cancelled run has to stop.
    signal.throwIfAborted()
    return message
  }
}

function bindTools(scope: RunScope, tools: AgentTool[], subagentId?: string): ToolSet {
  return Object.fromEntries(
    tools.map((agentTool) => [
      agentTool.name,
      tool({
        description: agentTool.description,
        inputSchema: agentTool.inputSchema,
        execute: (input, { toolCallId }) =>
          runGuarded(scope, agentTool, input, toolCallId, subagentId)
      })
    ])
  )
}

function createSpawnTool(scope: RunScope, depth: number, available: AgentTool[]): AgentTool {
  const canNest = depth + 1 < MAX_SUBAGENT_DEPTH
  const allowedNames = available.map((agentTool) => agentTool.name)
  if (canNest) allowedNames.push(SPAWN_TOOL_NAME)
  const readOnlyNames = available
    .filter((agentTool) => agentTool.risk === 'read')
    .map((agentTool) => agentTool.name)

  return defineTool({
    name: SPAWN_TOOL_NAME,
    // Starting a subagent changes nothing by itself. Its tools pass through the same check.
    risk: 'read',
    description:
      'Delegate a self contained task to a new subagent with its own empty context. ' +
      'It has only read tools unless allowedTools lists more. It returns a final summary. ' +
      `Available tools: ${allowedNames.join(', ')}.`,
    inputSchema: z.object({
      name: z.string().min(1).describe('Short name shown to the user'),
      instructions: z.string().min(1).describe('The role and rules of the subagent'),
      task: z.string().min(1).describe('The complete task. The subagent sees nothing else.'),
      allowedTools: z.array(z.string()).optional()
    }),
    summarize: ({ name }) => `Start subagent ${name}`,
    run: async ({ name, instructions, task, allowedTools }) => {
      const requested = allowedTools ?? readOnlyNames
      const forbidden = requested.filter((toolName) => !allowedNames.includes(toolName))
      if (forbidden.length > 0) {
        throw new Error(`These tools are not available to a subagent: ${forbidden.join(', ')}.`)
      }

      const subagentId = randomUUID()
      const granted = available.filter((agentTool) => requested.includes(agentTool.name))
      const tools = requested.includes(SPAWN_TOOL_NAME)
        ? [...granted, createSpawnTool(scope, depth + 1, granted)]
        : granted

      scope.recorder.subagent(subagentId, name, 'started')
      try {
        const agent = new ToolLoopAgent({
          model: scope.model,
          instructions: subagentInstructions(instructions, scope.root),
          tools: bindTools(scope, tools, subagentId),
          stopWhen: stepCountIs(MAX_SUBAGENT_STEPS),
          onLanguageModelCallEnd: (call) => scope.recordSubagentStep(call)
        })
        const result = await agent.generate({ prompt: task, abortSignal: scope.signal })
        scope.recorder.subagent(subagentId, name, 'completed')
        return result.text || 'The subagent finished without a summary.'
      } catch (error) {
        scope.recorder.subagent(subagentId, name, 'failed')
        throw error
      }
    }
  })
}

/** The tool set of a top level agent. */
export function createRunTools(scope: RunScope): ToolSet {
  const base = [...BASE_TOOLS]
  return bindTools(scope, [...base, createSpawnTool(scope, 0, base)])
}
