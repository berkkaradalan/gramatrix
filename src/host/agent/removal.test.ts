import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { secretName } from '@shared/rpc'
import type { PermissionMode, RunEvent } from '@shared/types'
import { BASE_URL_OVERRIDE_VARIABLE } from '../providers/resolve-model'
import { createTestHost, type TestHost } from '../testing'
import { createProjectDirectory } from './testing'

/** Answers every request with the same tool call, like a provider that keeps working. */
function startToolCallingServer(name: string, input: unknown): Promise<Server> {
  const toolCall = { index: 0, id: 'call-1', type: 'function' }
  const callFunction = { name, arguments: JSON.stringify(input) }
  const chunks = [
    {
      id: '1',
      choices: [{ index: 0, delta: { tool_calls: [{ ...toolCall, function: callFunction }] } }]
    },
    { id: '1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
  ]
  const body = [...chunks.map((chunk) => JSON.stringify(chunk)), '[DONE]']
    .map((line) => `data: ${line}\n\n`)
    .join('')
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(body)
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

interface Scenario extends TestHost {
  root: string
  projectId: string
  chatId: string
  runEvents(): RunEvent[]
  wait(condition: () => boolean): Promise<void>
}

function scenario(server: Server, permissionMode: PermissionMode): Scenario {
  const { port } = server.address() as AddressInfo
  vi.stubEnv(BASE_URL_OVERRIDE_VARIABLE, `http://127.0.0.1:${port}/v1`)
  const testHost = createTestHost()
  testHost.secrets.set(secretName.provider('openai'), 'test-key')
  const root = createProjectDirectory()
  const project = testHost.host.services.projects.add(root)
  const chat = testHost.host.services.chats.create({
    projectId: project.id,
    model: { provider: 'openai', model: 'test' },
    permissionMode
  })
  return {
    ...testHost,
    root,
    projectId: project.id,
    chatId: chat.id,
    runEvents: () =>
      testHost.events.flatMap(({ event, payload }) =>
        event === 'run.event' ? [payload as RunEvent] : []
      ),
    wait: async (condition) => {
      for (let attempt = 0; attempt < 400; attempt++) {
        if (condition()) return
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      throw new Error('Timed out waiting for a condition.')
    }
  }
}

describe('removing a chat or project during a run', () => {
  let server: Server | undefined

  afterEach(() => {
    server?.close()
    vi.unstubAllEnvs()
  })

  it('settles a pending approval and ends the run when the chat is removed', async () => {
    server = await startToolCallingServer('write_file', { path: 'out.txt', content: 'x' })
    const { host, chatId, root, runEvents, wait } = scenario(server, 'ask')
    const { agent } = host.services

    await host.router.dispatch('agent.send', { chatId, text: 'go' })
    await wait(() => agent.pendingApprovals(chatId).length === 1)

    await host.router.dispatch('chats.remove', { id: chatId })

    expect(agent.pendingApprovals(chatId)).toEqual([])
    await wait(() => !agent.isRunning(chatId))
    expect(runEvents().at(-1)?.type).toBe('cancelled')
    expect(existsSync(join(root, 'out.txt'))).toBe(false)
  })

  it('kills a running command when the chat is removed', async () => {
    server = await startToolCallingServer('run_command', { command: 'sleep 0.3; touch late.txt' })
    const { host, chatId, root, runEvents, wait } = scenario(server, 'full-access')
    const { agent } = host.services

    await host.router.dispatch('agent.send', { chatId, text: 'go' })
    await wait(() => runEvents().some(({ type }) => type === 'tool-call'))
    await new Promise((resolve) => setTimeout(resolve, 30))

    await host.router.dispatch('chats.remove', { id: chatId })

    await wait(() => !agent.isRunning(chatId))
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(existsSync(join(root, 'late.txt'))).toBe(false)
    expect(runEvents().at(-1)?.type).toBe('cancelled')
  })

  it('ends the run when the project is removed', async () => {
    server = await startToolCallingServer('write_file', { path: 'out.txt', content: 'x' })
    const { host, chatId, projectId, wait } = scenario(server, 'ask')
    const { agent } = host.services

    await host.router.dispatch('agent.send', { chatId, text: 'go' })
    await wait(() => agent.pendingApprovals(chatId).length === 1)

    await host.router.dispatch('projects.remove', { id: projectId })

    await wait(() => !agent.isRunning(chatId))
    expect(agent.pendingApprovals(chatId)).toEqual([])
  })
})
