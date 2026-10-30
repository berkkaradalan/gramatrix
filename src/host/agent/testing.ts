import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test'
import type { RunEvent } from '@shared/types'
import { UsageService } from '../services/usage'
import { createTestHost, type TestHost } from '../testing'
import { AgentService } from './agent-service'

/** One model response. Tool calls end the step, so the agent loop asks for the next one. */
export interface ScriptedStep {
  text?: string
  reasoning?: string
  toolCalls?: { name: string; input: unknown }[]
  /** Fails the model request. */
  error?: string
  /** Never responds until the request is aborted. */
  hang?: boolean
}

/** Every scripted step reports these tokens. */
export const STEP_USAGE = {
  inputTokens: { total: 100, noCache: 80, cacheRead: 20, cacheWrite: undefined },
  outputTokens: { total: 50, text: 40, reasoning: 10 }
}

let nextCallId = 1

function callsOf(step: ScriptedStep): { toolCallId: string; toolName: string; input: string }[] {
  return (step.toolCalls ?? []).map(({ name, input }) => ({
    toolCallId: `call-${nextCallId++}`,
    toolName: name,
    input: JSON.stringify(input)
  }))
}

function finishReason(step: ScriptedStep): { unified: string; raw: undefined } {
  return { unified: step.toolCalls?.length ? 'tool-calls' : 'stop', raw: undefined }
}

function streamParts(step: ScriptedStep): unknown[] {
  return [
    { type: 'stream-start', warnings: [] },
    ...(step.reasoning
      ? [
          { type: 'reasoning-start', id: 'r' },
          { type: 'reasoning-delta', id: 'r', delta: step.reasoning },
          { type: 'reasoning-end', id: 'r' }
        ]
      : []),
    ...(step.text
      ? [
          { type: 'text-start', id: 't' },
          { type: 'text-delta', id: 't', delta: step.text },
          { type: 'text-end', id: 't' }
        ]
      : []),
    ...callsOf(step).map((call) => ({ type: 'tool-call', ...call })),
    { type: 'finish', usage: STEP_USAGE, finishReason: finishReason(step) }
  ]
}

function hangingStream(signal: AbortSignal | undefined): ReadableStream<never> {
  return new ReadableStream({
    start: (controller) => {
      signal?.addEventListener('abort', () =>
        controller.error(new DOMException('Aborted', 'AbortError'))
      )
    }
  })
}

/**
 * A model that plays back fixed steps. Agents use the streaming call and subagents use the
 * generating call, and both take the next step from the same list.
 */
export function scriptedModel(steps: ScriptedStep[]): MockLanguageModelV4 {
  const queue = [...steps]
  const next = (): ScriptedStep => {
    const step = queue.shift()
    if (!step) throw new Error('The scripted model ran out of steps.')
    if (step.error) throw new Error(step.error)
    return step
  }

  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      const step = next()
      const stream = step.hang
        ? hangingStream(abortSignal)
        : convertArrayToReadableStream(streamParts(step))
      return { stream } as never
    },
    doGenerate: async ({ abortSignal }) => {
      const step = next()
      if (step.hang) {
        await new Promise((_, reject) => {
          abortSignal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          )
        })
      }
      return {
        content: [
          ...(step.text ? [{ type: 'text', text: step.text }] : []),
          ...callsOf(step).map((call) => ({ type: 'tool-call', ...call }))
        ],
        finishReason: finishReason(step),
        usage: STEP_USAGE,
        warnings: []
      } as never
    }
  })
}

export function createProjectDirectory(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'gramatrix-project-')))
}

export interface AgentHarness extends TestHost {
  agent: AgentService
  usage: UsageService
  chatId: string
  root: string
  runEvents(): RunEvent[]
  waitForEvent(type: RunEvent['type']): Promise<RunEvent>
  wait(condition: () => boolean): Promise<void>
  /** The model the agent resolved, for inspecting the prompts it received. */
  lastModel(): Promise<MockLanguageModelV4>
  /** Makes model resolution fail, like a missing API key does. */
  setResolveFailure(message: string): void
}

/** A test host with one project, one chat and an agent driven by the given steps. */
export function createAgentHarness(
  steps: ScriptedStep[],
  permissionMode: 'read-only' | 'ask' | 'accept-edits' | 'full-access' = 'full-access',
  { general = false }: { general?: boolean } = {}
): AgentHarness {
  const testHost = createTestHost()
  const { chats, projects } = testHost.host.services
  const root = createProjectDirectory()
  const project = projects.add(root)
  const chat = chats.create({
    projectId: general ? null : project.id,
    model: { provider: 'openai', model: 'test' },
    permissionMode
  })
  const model = scriptedModel(steps)
  const usage = new UsageService(testHost.context, { findModel: async () => undefined })
  let resolveFailure: string | null = null
  const agent = new AgentService(testHost.context, {
    chats,
    projects,
    usage,
    resolveModel: async () => {
      if (resolveFailure) throw new Error(resolveFailure)
      return model
    }
  })

  agent.register(testHost.host.router)

  const runEvents = (): RunEvent[] =>
    testHost.events.flatMap(({ event, payload }) =>
      event === 'run.event' ? [payload as RunEvent] : []
    )
  const wait = async (condition: () => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (condition()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error('Timed out waiting for a condition.')
  }
  const waitForEvent = async (type: RunEvent['type']): Promise<RunEvent> => {
    await wait(() => runEvents().some((event) => event.type === type))
    return runEvents().find((event) => event.type === type) as RunEvent
  }

  return {
    ...testHost,
    agent,
    usage,
    chatId: chat.id,
    root,
    runEvents,
    wait,
    waitForEvent,
    lastModel: async () => model,
    setResolveFailure: (message) => {
      resolveFailure = message
    }
  }
}
