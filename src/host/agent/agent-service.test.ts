import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ApprovalRequest, RunEvent, ToolCallPart } from '@shared/types'
import { createAgentHarness, createProjectDirectory, type AgentHarness } from './testing'

const WRITE_CALL = { name: 'write_file', input: { path: 'out.txt', content: 'data' } }
const COMMAND_CALL = { name: 'run_command', input: { command: 'touch ran.txt' } }

/** Starts a process in its own session. It uses Node because macOS has no setsid command. */
const START_DETACHED_CHILD = `node -e "
  const child = require('child_process').spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
  require('fs').writeFileSync('child.pid', String(child.pid))
  child.unref()
"`
const SLOW_COMMAND_CALL = { name: 'run_command', input: { command: 'sleep 0.1' } }

function toolParts(harness: AgentHarness): ToolCallPart[] {
  return harness.host.services.chats
    .messages(harness.chatId)
    .flatMap((message) => message.parts)
    .filter((part): part is ToolCallPart => part.type === 'tool-call')
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function pendingApproval(harness: AgentHarness): Promise<ApprovalRequest> {
  const event = await harness.waitForEvent('approval-requested')
  return (event as Extract<RunEvent, { type: 'approval-requested' }>).request
}

describe('agent runs', () => {
  it('streams text, stores both messages and names the chat', async () => {
    const harness = createAgentHarness([{ reasoning: 'hmm', text: 'Hello there' }])
    harness.agent.send(harness.chatId, 'Say hello\nsecond line')
    await harness.waitForEvent('finished')

    const types = harness.runEvents().map((event) => event.type)
    expect(types).toEqual(['started', 'reasoning-delta', 'text-delta', 'finished'])
    const [user, assistant] = harness.host.services.chats.messages(harness.chatId)
    expect(user?.parts).toEqual([{ type: 'text', text: 'Say hello\nsecond line' }])
    expect(assistant?.parts).toEqual([
      { type: 'reasoning', text: 'hmm' },
      { type: 'text', text: 'Hello there' }
    ])
    expect(harness.host.services.chats.get(harness.chatId).title).toBe('Say hello')
  })

  it('keeps a title that was already set', async () => {
    const harness = createAgentHarness([{ text: 'ok' }])
    harness.host.services.chats.update(harness.chatId, { title: 'Mine' })
    harness.agent.send(harness.chatId, 'hello')
    await harness.waitForEvent('finished')
    expect(harness.host.services.chats.get(harness.chatId).title).toBe('Mine')
  })

  it('shortens long titles', async () => {
    const harness = createAgentHarness([{ text: 'ok' }])
    harness.agent.send(harness.chatId, 'x'.repeat(200))
    await harness.waitForEvent('finished')
    const { title } = harness.host.services.chats.get(harness.chatId)
    expect(title.length).toBeLessThanOrEqual(60)
    expect(title.endsWith('...')).toBe(true)
  })

  it('runs tools and continues until the model stops', async () => {
    const harness = createAgentHarness([
      { text: 'Writing', toolCalls: [WRITE_CALL] },
      { text: 'Done' }
    ])
    harness.agent.send(harness.chatId, 'write it')
    await harness.waitForEvent('finished')

    expect(readFileSync(join(harness.root, 'out.txt'), 'utf8')).toBe('data')
    expect(toolParts(harness)).toMatchObject([
      { toolName: 'write_file', state: 'completed', output: 'Wrote 4 bytes to out.txt.' }
    ])
    const types = harness.runEvents().map((event) => event.type)
    expect(types).toContain('tool-call')
    expect(types).toContain('tool-update')
  })

  it('sends earlier turns to the model again', async () => {
    const harness = createAgentHarness([
      { text: 'first', toolCalls: [{ name: 'list_dir', input: {} }] },
      { text: 'second' },
      { text: 'third' }
    ])
    harness.agent.send(harness.chatId, 'one')
    await harness.wait(() => harness.runEvents().some((event) => event.type === 'finished'))
    harness.events.length = 0
    harness.agent.send(harness.chatId, 'two')
    await harness.waitForEvent('finished')

    const model = await harness.lastModel()
    const prompt = model.doStreamCalls.at(-1)?.prompt ?? []
    expect(prompt.map(({ role }) => role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'user'
    ])
  })

  it('allows one active run per chat', async () => {
    const harness = createAgentHarness([{ hang: true }])
    harness.agent.send(harness.chatId, 'one')
    expect(() => harness.agent.send(harness.chatId, 'two')).toThrow('already has an active run')
    await expect(
      harness.agent.runHeadless({ chatId: harness.chatId, text: 'three', source: 'job' })
    ).rejects.toThrow('already has an active run')
    harness.agent.cancel(harness.chatId)
    await harness.waitForEvent('cancelled')
  })

  it('retries the last message without storing it twice', async () => {
    const harness = createAgentHarness([{ error: 'Rate limited' }, { text: 'Recovered' }])
    harness.agent.send(harness.chatId, 'hello')
    await harness.waitForEvent('failed')

    harness.agent.retry(harness.chatId)
    await harness.waitForEvent('finished')

    const stored = harness.host.services.chats.messages(harness.chatId)
    expect(stored.map(({ role }) => role)).toEqual(['user', 'assistant'])
    expect(stored[1]?.parts).toEqual([{ type: 'text', text: 'Recovered' }])
  })

  it('refuses to retry an empty chat', () => {
    const harness = createAgentHarness([])
    expect(() => harness.agent.retry(harness.chatId)).toThrow('no message to retry')
  })

  it('reports model failures and frees the chat', async () => {
    const harness = createAgentHarness([{ error: 'quota exceeded' }, { text: 'recovered' }])
    harness.agent.send(harness.chatId, 'one')
    const event = await harness.waitForEvent('failed')
    expect((event as Extract<RunEvent, { type: 'failed' }>).error).toContain('quota exceeded')

    harness.events.length = 0
    harness.agent.send(harness.chatId, 'two')
    await harness.waitForEvent('finished')
  })

  it('reports a missing key as a failed run', async () => {
    const harness = createAgentHarness([])
    harness.setResolveFailure('No API key is set.')
    harness.agent.send(harness.chatId, 'hello')
    const event = await harness.waitForEvent('failed')
    expect((event as Extract<RunEvent, { type: 'failed' }>).error).toBe('No API key is set.')
  })

  it('lets the model recover from a failing tool', async () => {
    const harness = createAgentHarness([
      { toolCalls: [{ name: 'read_file', input: { path: 'missing.txt' } }] },
      { text: 'That file is missing' }
    ])
    harness.agent.send(harness.chatId, 'read it')
    await harness.waitForEvent('finished')
    expect(toolParts(harness)).toMatchObject([{ state: 'failed' }])
    expect(String(toolParts(harness)[0]?.output)).toContain('Error:')
  })

  it('records calls the SDK rejects because the input is invalid', async () => {
    const harness = createAgentHarness([
      { toolCalls: [{ name: 'read_file', input: { wrong: true } }] },
      { text: 'Sorry' }
    ])
    harness.agent.send(harness.chatId, 'read it')
    await harness.waitForEvent('finished')
    expect(toolParts(harness)).toMatchObject([{ toolName: 'read_file', state: 'failed' }])
  })

  it('confines file tools to the project even in full access mode', async () => {
    const outside = createProjectDirectory()
    const harness = createAgentHarness([
      { toolCalls: [{ name: 'write_file', input: { path: join(outside, 'x'), content: 'x' } }] },
      { text: 'blocked' }
    ])
    harness.agent.send(harness.chatId, 'escape')
    await harness.waitForEvent('finished')
    expect(existsSync(join(outside, 'x'))).toBe(false)
    expect(toolParts(harness)).toMatchObject([{ state: 'failed' }])
  })
})

describe('general chats', () => {
  it('answers with no tools and says so in the instructions', async () => {
    const harness = createAgentHarness([{ text: 'Hello' }], 'full-access', { general: true })
    harness.agent.send(harness.chatId, 'hi')
    await harness.waitForEvent('finished')

    const model = await harness.lastModel()
    const call = model.doStreamCalls[0]
    expect(call?.tools ?? []).toEqual([])
    expect(JSON.stringify(call?.prompt)).toContain('no tools')
    expect(JSON.stringify(call?.prompt)).toContain('open a project')
  })

  it('never reaches a tool, even if the model asks for one', async () => {
    const harness = createAgentHarness(
      [{ toolCalls: [WRITE_CALL] }, { text: 'I cannot do that' }],
      'full-access',
      { general: true }
    )
    harness.agent.send(harness.chatId, 'write a file')
    await harness.waitForEvent('finished')

    expect(existsSync(join(harness.root, 'out.txt'))).toBe(false)
    const types = harness.runEvents().map((event) => event.type)
    expect(types).not.toContain('approval-requested')
    expect(toolParts(harness).every(({ state }) => state === 'failed')).toBe(true)
  })

  it('offers no subagents', async () => {
    const harness = createAgentHarness(
      [
        {
          toolCalls: [
            {
              name: 'spawn_subagent',
              input: { name: 'helper', instructions: 'Help.', task: 'Do it.' }
            }
          ]
        },
        { text: 'no' }
      ],
      'full-access',
      { general: true }
    )
    harness.agent.send(harness.chatId, 'go')
    await harness.waitForEvent('finished')
    expect(harness.runEvents().map((event) => event.type)).not.toContain('subagent')
  })

  it('keeps earlier turns', async () => {
    const harness = createAgentHarness([{ text: 'one' }, { text: 'two' }], 'ask', { general: true })
    harness.agent.send(harness.chatId, 'first')
    await harness.waitForEvent('finished')
    harness.events.length = 0
    harness.agent.send(harness.chatId, 'second')
    await harness.waitForEvent('finished')
    const model = await harness.lastModel()
    expect(model.doStreamCalls.at(-1)?.prompt.map(({ role }) => role)).toEqual([
      'system',
      'user',
      'assistant',
      'user'
    ])
  })

  it('works headless, which is how channels use it', async () => {
    const harness = createAgentHarness([{ text: 'Hi from general' }], 'read-only', {
      general: true
    })
    const result = await harness.agent.runHeadless({
      chatId: harness.chatId,
      text: 'hi',
      source: 'channel'
    })
    expect(result.text).toBe('Hi from general')
  })
})

describe('permission modes', () => {
  it('read-only denies writes and commands but allows reads', async () => {
    const harness = createAgentHarness(
      [
        {
          toolCalls: [WRITE_CALL, COMMAND_CALL, { name: 'list_dir', input: {} }]
        },
        { text: 'done' }
      ],
      'read-only'
    )
    harness.agent.send(harness.chatId, 'go')
    await harness.waitForEvent('finished')

    expect(existsSync(join(harness.root, 'out.txt'))).toBe(false)
    expect(existsSync(join(harness.root, 'ran.txt'))).toBe(false)
    expect(toolParts(harness).map((part) => part.state)).toEqual(['denied', 'denied', 'completed'])
  })

  it('ask waits for approval and then runs the tool', async () => {
    const harness = createAgentHarness([{ toolCalls: [WRITE_CALL] }, { text: 'done' }], 'ask')
    harness.agent.send(harness.chatId, 'go')
    const request = await pendingApproval(harness)

    expect(request.summary).toBe('Write out.txt')
    expect(existsSync(join(harness.root, 'out.txt'))).toBe(false)
    expect(toolParts(harness)[0]?.state).toBe('awaiting-approval')

    await harness.host.router.dispatch('agent.resolveApproval', {
      requestId: request.id,
      approved: true
    })
    await harness.waitForEvent('finished')
    expect(existsSync(join(harness.root, 'out.txt'))).toBe(true)
    expect(harness.runEvents().map((event) => event.type)).toContain('approval-resolved')
  })

  it('ask tells the model when the user says no', async () => {
    const harness = createAgentHarness([{ toolCalls: [WRITE_CALL] }, { text: 'understood' }], 'ask')
    harness.agent.send(harness.chatId, 'go')
    const request = await pendingApproval(harness)
    harness.agent.resolveApproval(request.id, false)
    await harness.waitForEvent('finished')

    expect(existsSync(join(harness.root, 'out.txt'))).toBe(false)
    expect(toolParts(harness)[0]).toMatchObject({ state: 'denied' })
    expect(String(toolParts(harness)[0]?.output)).toContain('Permission denied')
  })

  it('accept-edits writes freely but asks before commands', async () => {
    const harness = createAgentHarness(
      [{ toolCalls: [WRITE_CALL] }, { toolCalls: [COMMAND_CALL] }, { text: 'done' }],
      'accept-edits'
    )
    harness.agent.send(harness.chatId, 'go')
    const request = await pendingApproval(harness)
    expect(existsSync(join(harness.root, 'out.txt'))).toBe(true)
    expect(request.toolName).toBe('run_command')
    harness.agent.resolveApproval(request.id, true)
    await harness.waitForEvent('finished')
    expect(existsSync(join(harness.root, 'ran.txt'))).toBe(true)
  })

  it('full-access never asks', async () => {
    const harness = createAgentHarness([
      { toolCalls: [WRITE_CALL, COMMAND_CALL] },
      { text: 'done' }
    ])
    harness.agent.send(harness.chatId, 'go')
    await harness.waitForEvent('finished')
    expect(harness.runEvents().map((event) => event.type)).not.toContain('approval-requested')
    expect(existsSync(join(harness.root, 'ran.txt'))).toBe(true)
  })

  it('applies a lowered mode to the next tool call of a running turn', async () => {
    const harness = createAgentHarness([
      { toolCalls: [SLOW_COMMAND_CALL] },
      { toolCalls: [WRITE_CALL] },
      { text: 'done' }
    ])
    harness.agent.send(harness.chatId, 'go')
    await harness.waitForEvent('tool-call')
    harness.host.services.chats.update(harness.chatId, { permissionMode: 'read-only' })
    await harness.waitForEvent('finished')

    expect(existsSync(join(harness.root, 'out.txt'))).toBe(false)
    expect(toolParts(harness).at(-1)?.state).toBe('denied')
  })

  it('applies a lowered mode inside a subagent', async () => {
    const harness = createAgentHarness([
      {
        toolCalls: [
          {
            name: 'spawn_subagent',
            input: {
              name: 'helper',
              instructions: 'Help.',
              task: 'Do it.',
              allowedTools: ['write_file', 'run_command']
            }
          }
        ]
      },
      { toolCalls: [SLOW_COMMAND_CALL] },
      { toolCalls: [WRITE_CALL] },
      { text: 'blocked' },
      { text: 'done' }
    ])
    harness.agent.send(harness.chatId, 'go')
    await harness.wait(() => toolParts(harness).some(({ toolName }) => toolName === 'run_command'))
    harness.host.services.chats.update(harness.chatId, { permissionMode: 'read-only' })
    await harness.waitForEvent('finished')
    expect(existsSync(join(harness.root, 'out.txt'))).toBe(false)
  })

  it('does not run an approved tool if the mode dropped while the prompt was open', async () => {
    const harness = createAgentHarness([{ toolCalls: [WRITE_CALL] }, { text: 'done' }], 'ask')
    harness.agent.send(harness.chatId, 'go')
    const request = await pendingApproval(harness)
    harness.host.services.chats.update(harness.chatId, { permissionMode: 'read-only' })
    harness.agent.resolveApproval(request.id, true)
    await harness.waitForEvent('finished')
    expect(existsSync(join(harness.root, 'out.txt'))).toBe(false)
    expect(toolParts(harness)[0]?.state).toBe('denied')
  })

  it('gives accept-edits no way to change git config', async () => {
    const harness = createAgentHarness(
      [
        { toolCalls: [{ name: 'write_file', input: { path: '.git/config', content: 'x' } }] },
        { text: 'blocked' }
      ],
      'accept-edits'
    )
    harness.agent.send(harness.chatId, 'go')
    await harness.waitForEvent('finished')
    expect(existsSync(join(harness.root, '.git/config'))).toBe(false)
    expect(toolParts(harness)[0]?.state).toBe('failed')
  })

  it('lists and clears pending approvals through the router', async () => {
    const harness = createAgentHarness([{ toolCalls: [WRITE_CALL] }, { text: 'done' }], 'ask')
    harness.agent.send(harness.chatId, 'go')
    const request = await pendingApproval(harness)
    const pending = await harness.host.router.dispatch('agent.pendingApprovals', {
      chatId: harness.chatId
    })
    expect(pending).toEqual([request])
    harness.agent.resolveApproval(request.id, true)
    await harness.waitForEvent('finished')
    expect(harness.agent.pendingApprovals(harness.chatId)).toEqual([])
  })
})

describe('headless runs', () => {
  it('returns the final answer', async () => {
    const harness = createAgentHarness([
      { text: 'Working', toolCalls: [{ name: 'list_dir', input: {} }] },
      { text: 'Final answer' }
    ])
    const result = await harness.agent.runHeadless({
      chatId: harness.chatId,
      text: 'go',
      source: 'job'
    })
    expect(result.text).toBe('Final answer')
    expect(result.message.role).toBe('assistant')
    expect(result.message.parts.length).toBeGreaterThan(1)
  })

  it('denies instead of waiting when approval would be needed', async () => {
    const harness = createAgentHarness([{ toolCalls: [WRITE_CALL] }, { text: 'skipped' }], 'ask')
    const result = await harness.agent.runHeadless({
      chatId: harness.chatId,
      text: 'go',
      source: 'job'
    })
    expect(result.text).toBe('skipped')
    expect(existsSync(join(harness.root, 'out.txt'))).toBe(false)
    expect(toolParts(harness)[0]?.state).toBe('denied')
    expect(harness.runEvents().map((event) => event.type)).not.toContain('approval-requested')
  })

  it('cannot raise the mode stored on the chat', async () => {
    const harness = createAgentHarness([{ toolCalls: [WRITE_CALL] }, { text: 'done' }], 'read-only')
    await harness.agent.runHeadless({
      chatId: harness.chatId,
      text: 'go',
      source: 'job',
      permissionMode: 'full-access'
    })
    expect(existsSync(join(harness.root, 'out.txt'))).toBe(false)
  })

  it('can lower the mode stored on the chat', async () => {
    const harness = createAgentHarness([{ toolCalls: [WRITE_CALL] }, { text: 'done' }])
    await harness.agent.runHeadless({
      chatId: harness.chatId,
      text: 'go',
      source: 'job',
      permissionMode: 'read-only'
    })
    expect(existsSync(join(harness.root, 'out.txt'))).toBe(false)
  })

  it('applies a mode lowered on the chat during the run', async () => {
    const harness = createAgentHarness([
      { toolCalls: [SLOW_COMMAND_CALL] },
      { toolCalls: [WRITE_CALL] },
      { text: 'done' }
    ])
    const run = harness.agent.runHeadless({
      chatId: harness.chatId,
      text: 'go',
      source: 'job',
      permissionMode: 'full-access'
    })
    await harness.waitForEvent('tool-call')
    harness.host.services.chats.update(harness.chatId, { permissionMode: 'read-only' })
    await run
    expect(existsSync(join(harness.root, 'out.txt'))).toBe(false)
  })

  it('rejects when the model fails', async () => {
    const harness = createAgentHarness([{ error: 'boom' }])
    await expect(
      harness.agent.runHeadless({ chatId: harness.chatId, text: 'go', source: 'job' })
    ).rejects.toThrow('boom')
  })

  it('rejects when its signal aborts', async () => {
    const harness = createAgentHarness([{ hang: true }])
    const controller = new AbortController()
    const run = harness.agent.runHeadless({
      chatId: harness.chatId,
      text: 'go',
      source: 'job',
      signal: controller.signal
    })
    setTimeout(() => controller.abort(), 20)
    await expect(run).rejects.toThrow('cancelled')
  })
})

describe('cancellation', () => {
  it('stops a waiting model request and frees the chat', async () => {
    const harness = createAgentHarness([{ hang: true }, { text: 'again' }])
    harness.agent.send(harness.chatId, 'one')
    await harness.waitForEvent('started')
    await harness.host.router.dispatch('agent.cancel', { chatId: harness.chatId })
    await harness.waitForEvent('cancelled')

    harness.events.length = 0
    harness.agent.send(harness.chatId, 'two')
    await harness.waitForEvent('finished')
  })

  it('kills a running command', async () => {
    const harness = createAgentHarness([
      { toolCalls: [{ name: 'run_command', input: { command: 'sleep 0.3; touch late.txt' } }] }
    ])
    harness.agent.send(harness.chatId, 'go')
    await harness.waitForEvent('tool-call')
    await new Promise((resolve) => setTimeout(resolve, 30))
    harness.agent.cancel(harness.chatId)
    await harness.waitForEvent('cancelled')
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(existsSync(join(harness.root, 'late.txt'))).toBe(false)
    expect(toolParts(harness)[0]?.state).toBe('failed')
  })

  it.each([
    [
      'a top level command',
      [{ toolCalls: [{ name: 'run_command', input: { command: 'sleep 5' } }] }]
    ],
    [
      'a command in a subagent',
      [
        {
          toolCalls: [
            {
              name: 'spawn_subagent',
              input: {
                name: 'helper',
                instructions: 'Help.',
                task: 'Do it.',
                allowedTools: ['run_command']
              }
            }
          ]
        },
        { toolCalls: [{ name: 'run_command', input: { command: 'sleep 5' } }] }
      ]
    ]
  ])('emits nothing after cancelled for %s, but saves the outcome', async (_name, steps) => {
    const harness = createAgentHarness(steps)
    harness.agent.send(harness.chatId, 'go')
    await harness.wait(() => toolParts(harness).some(({ toolName }) => toolName === 'run_command'))
    await new Promise((resolve) => setTimeout(resolve, 30))
    harness.agent.cancel(harness.chatId)
    await harness.waitForEvent('cancelled')
    await harness.wait(() => toolParts(harness).every(({ state }) => state !== 'running'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(harness.runEvents().at(-1)?.type).toBe('cancelled')
  })

  it('kills a detached child when the run is cancelled', async () => {
    const harness = createAgentHarness([
      {
        toolCalls: [
          {
            name: 'run_command',
            input: { command: `${START_DETACHED_CHILD} & sleep 30` }
          }
        ]
      }
    ])
    const pidFile = join(harness.root, 'child.pid')
    harness.agent.send(harness.chatId, 'go')
    await harness.wait(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').length > 0)
    const pid = Number(readFileSync(pidFile, 'utf8'))
    harness.agent.cancel(harness.chatId)
    await harness.wait(() => !isAlive(pid))
  })

  it('clears an open approval prompt', async () => {
    const harness = createAgentHarness([{ toolCalls: [WRITE_CALL] }], 'ask')
    harness.agent.send(harness.chatId, 'go')
    await pendingApproval(harness)
    harness.agent.cancel(harness.chatId)
    await harness.waitForEvent('cancelled')

    expect(harness.agent.pendingApprovals(harness.chatId)).toEqual([])
    expect(existsSync(join(harness.root, 'out.txt'))).toBe(false)
    expect(toolParts(harness)[0]?.state).toBe('denied')
  })

  it('stop cancels every active run and waits for it', async () => {
    const harness = createAgentHarness([{ hang: true }])
    harness.agent.send(harness.chatId, 'one')
    await harness.waitForEvent('started')
    await harness.agent.stop()
    expect(harness.runEvents().at(-1)?.type).toBe('cancelled')
    expect(harness.agent.isRunning(harness.chatId)).toBe(false)
  })

  it('stop kills background processes of commands that already finished', async () => {
    const harness = createAgentHarness([
      { toolCalls: [{ name: 'run_command', input: { command: 'sleep 30 & echo $! > bg.pid' } }] },
      { text: 'started it' }
    ])
    harness.agent.send(harness.chatId, 'go')
    await harness.waitForEvent('finished')
    const pid = Number(readFileSync(join(harness.root, 'bg.pid'), 'utf8'))
    expect(isAlive(pid)).toBe(true)

    await harness.agent.stop()
    await harness.wait(() => !isAlive(pid))
  })

  it('stop finds processes that left their process group', async () => {
    const harness = createAgentHarness([
      {
        toolCalls: [
          {
            name: 'run_command',
            input: { command: START_DETACHED_CHILD }
          }
        ]
      },
      { text: 'started it' }
    ])
    harness.agent.send(harness.chatId, 'go')
    await harness.waitForEvent('finished')
    const pidFile = join(harness.root, 'child.pid')
    await harness.wait(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').length > 0)
    const pid = Number(readFileSync(pidFile, 'utf8'))
    expect(isAlive(pid)).toBe(true)

    await harness.agent.stop()
    await harness.wait(() => !isAlive(pid))
  })
})

describe('subagents', () => {
  const spawn = (input: object): { name: string; input: object } => ({
    name: 'spawn_subagent',
    input: { name: 'helper', instructions: 'Help.', task: 'Do it.', ...input }
  })

  it('runs with a fresh context and returns its summary', async () => {
    const harness = createAgentHarness([
      { toolCalls: [spawn({})] },
      { text: 'The summary' },
      { text: 'All done' }
    ])
    harness.agent.send(harness.chatId, 'secret parent context')
    await harness.waitForEvent('finished')

    const model = await harness.lastModel()
    const subagentPrompt = JSON.stringify(model.doGenerateCalls[0]?.prompt)
    expect(subagentPrompt).toContain('Do it.')
    expect(subagentPrompt).not.toContain('secret parent context')
    expect(toolParts(harness)[0]).toMatchObject({ state: 'completed', output: 'The summary' })

    const statuses = harness
      .runEvents()
      .flatMap((event) => (event.type === 'subagent' ? [event.status] : []))
    expect(statuses).toEqual(['started', 'completed'])
  })

  it('gets only read tools unless more are listed', async () => {
    const harness = createAgentHarness([
      { toolCalls: [spawn({})] },
      { toolCalls: [WRITE_CALL] },
      { text: 'could not write' },
      { text: 'done' }
    ])
    harness.agent.send(harness.chatId, 'go')
    await harness.waitForEvent('finished')

    const model = await harness.lastModel()
    const names = model.doGenerateCalls[0]?.tools?.map((tool) => tool.name)
    expect(names?.sort()).toEqual(['list_dir', 'read_file', 'search_files'])
    expect(existsSync(join(harness.root, 'out.txt'))).toBe(false)
  })

  it('rejects tools the parent does not offer', async () => {
    const harness = createAgentHarness([
      { toolCalls: [spawn({ allowedTools: ['read_file', 'format_disk'] })] },
      { text: 'done' }
    ])
    harness.agent.send(harness.chatId, 'go')
    await harness.waitForEvent('finished')
    expect(toolParts(harness)[0]).toMatchObject({ state: 'failed' })
    expect(String(toolParts(harness)[0]?.output)).toContain('format_disk')
  })

  it('cannot widen access beyond its own parent', async () => {
    const harness = createAgentHarness([
      { toolCalls: [spawn({ allowedTools: ['read_file', 'spawn_subagent'] })] },
      { toolCalls: [spawn({ allowedTools: ['write_file'] })] },
      { text: 'no luck' },
      { text: 'done' }
    ])
    harness.agent.send(harness.chatId, 'go')
    await harness.waitForEvent('finished')
    const nested = toolParts(harness).find((part) => part.subagentId)
    expect(nested).toMatchObject({ state: 'failed' })
    expect(String(nested?.output)).toContain('write_file')
  })

  it('stops nesting at the depth limit', async () => {
    const harness = createAgentHarness([
      { toolCalls: [spawn({ allowedTools: ['read_file', 'spawn_subagent'] })] },
      { toolCalls: [spawn({ allowedTools: ['read_file', 'spawn_subagent'] })] },
      { text: 'no deeper' },
      { text: 'done' }
    ])
    harness.agent.send(harness.chatId, 'go')
    await harness.waitForEvent('finished')
    const nested = toolParts(harness).find((part) => part.subagentId)
    expect(nested).toMatchObject({ state: 'failed' })
    expect(String(nested?.output)).toContain('spawn_subagent')
  })

  it('reaches depth two but offers no spawn tool there', async () => {
    const harness = createAgentHarness([
      { toolCalls: [spawn({ allowedTools: ['read_file', 'spawn_subagent'] })] },
      { toolCalls: [spawn({ allowedTools: ['read_file'] })] },
      { text: 'deepest' },
      { text: 'middle' },
      { text: 'done' }
    ])
    harness.agent.send(harness.chatId, 'go')
    await harness.waitForEvent('finished')

    const model = await harness.lastModel()
    expect(model.doGenerateCalls[0]?.tools?.map((tool) => tool.name)).toContain('spawn_subagent')
    expect(model.doGenerateCalls[1]?.tools?.map((tool) => tool.name)).toEqual(['read_file'])
  })

  it('uses the same permission gate as its parent', async () => {
    const harness = createAgentHarness(
      [
        { toolCalls: [spawn({ allowedTools: ['write_file'] })] },
        { toolCalls: [WRITE_CALL] },
        { text: 'wrote it' },
        { text: 'done' }
      ],
      'ask'
    )
    harness.agent.send(harness.chatId, 'go')
    const request = await pendingApproval(harness)
    expect(request.toolName).toBe('write_file')
    expect(
      toolParts(harness).find((part) => part.toolName === 'write_file')?.subagentId
    ).toBeTruthy()

    harness.agent.resolveApproval(request.id, true)
    await harness.waitForEvent('finished')
    expect(existsSync(join(harness.root, 'out.txt'))).toBe(true)
  })

  it('stops when the parent is cancelled', async () => {
    const harness = createAgentHarness([{ toolCalls: [spawn({})] }, { hang: true }])
    harness.agent.send(harness.chatId, 'go')
    await harness.wait(() =>
      harness.runEvents().some((event) => event.type === 'subagent' && event.status === 'started')
    )
    harness.agent.cancel(harness.chatId)
    await harness.waitForEvent('cancelled')

    await harness.wait(() => !harness.agent.isRunning(harness.chatId))
    expect(harness.runEvents().at(-1)?.type).toBe('cancelled')
  })

  it('reads files in the project', async () => {
    const harness = createAgentHarness([
      { toolCalls: [spawn({})] },
      { toolCalls: [{ name: 'read_file', input: { path: 'note.txt' } }] },
      { text: 'note says hi' },
      { text: 'done' }
    ])
    writeFileSync(join(harness.root, 'note.txt'), 'hi')
    harness.agent.send(harness.chatId, 'go')
    await harness.waitForEvent('finished')
    expect(toolParts(harness).find((part) => part.subagentId)).toMatchObject({
      state: 'completed',
      output: 'hi'
    })
  })
})
