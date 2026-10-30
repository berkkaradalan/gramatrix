import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentService } from '../agent/agent-service'
import { createProjectDirectory } from '../agent/testing'
import { UsageService } from '../services/usage'
import { createTestHost } from '../testing'
import { BASE_URL_OVERRIDE_VARIABLE, createModelResolver } from './resolve-model'

/** Streams one fixed chat completion, the way end to end tests fake a provider. */
function startFakeServer(reply: string): Promise<Server> {
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      const chunk = { id: '1', choices: [{ index: 0, delta: { content: reply } }] }
      const stop = { id: '1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
      const usage = {
        id: '1',
        choices: [],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 }
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(stop)}\n\ndata: ${JSON.stringify(usage)}\n\ndata: [DONE]\n\n`
      )
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

describe('base URL override', () => {
  let server: Server | undefined

  afterEach(() => {
    server?.close()
  })

  it('runs an agent against a local OpenAI compatible server', async () => {
    server = await startFakeServer('hello from the fake server')
    const { port } = server.address() as AddressInfo
    const { context, host, secrets } = createTestHost()
    secrets.set('provider:anthropic', 'test-key')

    const { chats, projects } = host.services
    const project = projects.add(createProjectDirectory())
    const chat = chats.create({
      projectId: project.id,
      model: { provider: 'anthropic', model: 'any' },
      permissionMode: 'read-only'
    })
    const usage = new UsageService(context, { findModel: async () => undefined })
    const agent = new AgentService(context, {
      chats,
      projects,
      usage,
      resolveModel: createModelResolver(context, {
        [BASE_URL_OVERRIDE_VARIABLE]: `http://127.0.0.1:${port}/v1`
      })
    })

    const result = await agent.runHeadless({ chatId: chat.id, text: 'hi', source: 'channel' })
    expect(result.text).toBe('hello from the fake server')
    expect(usage.report({}).totals).toMatchObject({
      runs: 1,
      inputTokens: 12,
      outputTokens: 3,
      unpricedRuns: 1
    })
  })

  it('explains a rejected key when a run fails, without showing the key', async () => {
    const key = 'run-secret-value-1234'
    server = createServer((request, response) => {
      request.resume()
      request.on('end', () => {
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { code: '1000', message: `bad ${key}` } }))
      })
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const { context, host, secrets, events } = createTestHost()
    secrets.set('provider:zai-coding-plan', key)
    const { chats, projects } = host.services
    const chat = chats.create({
      projectId: projects.add(createProjectDirectory()).id,
      model: { provider: 'zai-coding-plan', model: 'glm-5.3' },
      permissionMode: 'read-only'
    })
    const agent = new AgentService(context, {
      chats,
      projects,
      resolveModel: createModelResolver(context, {
        [BASE_URL_OVERRIDE_VARIABLE]: `http://127.0.0.1:${port}/v1`
      })
    })

    await expect(agent.runHeadless({ chatId: chat.id, text: 'hi', source: 'job' })).rejects.toThrow(
      'Zhipu Coding Plan (China)'
    )
    expect(JSON.stringify(events)).not.toContain(key)
  })
})
