import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { secretName } from '@shared/rpc'
import type { ProviderId } from '@shared/types'
import { createTestHost } from '../testing'
import {
  explainFailure,
  failureDetails,
  scrubSecrets,
  type FailureDetails
} from './provider-errors'
import { ProviderService } from './provider-service'
import { BASE_URL_OVERRIDE_VARIABLE, createModelResolver } from './resolve-model'

const DETAILS: FailureDetails = { endpoint: 'host/path', model: 'glm-5.3', status: 401 }

function explain(
  provider: ProviderId,
  code: string | undefined,
  status = 429,
  key = 'abc'
): string {
  return explainFailure(provider, { ...DETAILS, status, code, message: 'Raw message' }, key)
}

describe('scrubSecrets', () => {
  it.each([
    ['sk-ant-api03-abcdefgh12345'],
    ['sk-cp-abcdefgh12345'],
    ['0123456789abcdef0123456789abcdef.AbCdEf123456'],
    ['0123456789abcdef0123456789abcdef'],
    ['sk-abc***********xyz'],
    ['gramatri********************alue']
  ])('removes %s', (secret) => {
    expect(scrubSecrets(`Rejected ${secret} here`)).toBe('Rejected [redacted] here')
  })

  it('removes a bearer header', () => {
    expect(scrubSecrets('authorization: Bearer abc.def')).not.toContain('abc.def')
  })

  it('removes the exact key whatever it looks like', () => {
    expect(scrubSecrets('bad value short1 here', 'short1')).toBe('bad value [redacted] here')
  })

  it('leaves ordinary text and model names alone', () => {
    const text = 'Model claude-sonnet-5-5 at api.z.ai/api/coding/paas/v4 failed'
    expect(scrubSecrets(text)).toBe(text)
  })
})

describe('explainFailure', () => {
  it('points a rejected Z.ai plan key at the China entry', () => {
    for (const code of ['1000', '401']) {
      const text = explain('zai-coding-plan', code, 401)
      expect(text).toContain('Zhipu Coding Plan (China)')
      expect(text).toContain('Personal Coding Plan tab')
    }
  })

  it('points a rejected Zhipu key back at the Z.ai entry', () => {
    expect(explain('zhipu-coding-plan', '1000', 401)).toContain('Z.ai Coding Plan')
  })

  it('points 1113 on a plan at the key type first', () => {
    const text = explain('zai-coding-plan', '1113')
    expect(text).toContain('Standard key')
    expect(text).toContain('Personal Coding Plan tab')
    expect(text).toContain('GLM-5.3-Flash')
  })

  it('treats 1113 on the pay as you go entry as balance', () => {
    expect(explain('zai', '1113')).toContain('no balance')
  })

  it.each([
    ['1211', 'does not know the model glm-5.3'],
    ['1302', 'rate limit'],
    ['1305', 'overloaded']
  ])('maps Z.ai error %s', (code, expected) => {
    expect(explain('zai', code)).toContain(expected)
  })

  it('keeps the reset time of a usage limit', () => {
    expect(explain('zai-coding-plan', '1308')).toContain('Raw message')
  })

  it('does not read Z.ai codes from other providers', () => {
    expect(explain('anthropic', '1113')).toContain('rate limit')
  })

  it.each([
    [401, 'did not accept this key'],
    [402, 'no credit'],
    [403, 'refused this key'],
    [404, 'has no glm-5.3'],
    [429, 'rate limit'],
    [500, 'having problems'],
    [418, 'HTTP 418']
  ])('maps HTTP %i for any provider', (status, expected) => {
    expect(explain('openai', undefined, status)).toContain(expected)
  })

  it('explains a connection failure without blaming the key', () => {
    const text = explainFailure('zai', { endpoint: 'x', model: 'm' }, 'abc')
    expect(text).toContain('Could not reach')
    expect(text).not.toContain('Coding Plan')
  })

  it('names the sibling entry for a misplaced key', () => {
    expect(explain('minimax', undefined, 401, 'sk-cp-abc')).toContain('MiniMax Token Plan')
    expect(explain('zai', undefined, 401)).toContain('Z.ai Coding Plan')
    expect(explain('zai', undefined, 500)).not.toContain('Z.ai Coding Plan')
  })
})

describe('failureDetails', () => {
  it('copes with an error that is not from an API call', () => {
    expect(failureDetails(new Error('boom'), 'https://a.example/v1', 'm')).toEqual({
      endpoint: 'a.example/v1',
      model: 'm',
      status: undefined,
      code: undefined,
      message: 'boom'
    })
  })
})

describe('providers.test against a server', () => {
  let server: Server | undefined

  afterEach(() => {
    server?.close()
    vi.unstubAllEnvs()
  })

  async function testAgainst(
    provider: ProviderId,
    key: string,
    status: number,
    body: unknown
  ): Promise<ReturnType<ProviderService['test']>> {
    server = createServer((request, response) => {
      request.resume()
      request.on('end', () => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(body))
      })
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    vi.stubEnv(BASE_URL_OVERRIDE_VARIABLE, `http://127.0.0.1:${port}/v1`)
    const { context, secrets } = createTestHost()
    secrets.set(secretName.provider(provider), key)
    return new ProviderService(context, createModelResolver(context)).test(provider)
  }

  it('returns plain advice and the raw facts for a Z.ai code', async () => {
    const result = await testAgainst('zai-coding-plan', 'plan-key', 429, {
      error: { code: '1113', message: 'Insufficient balance' }
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Standard key')
    expect(result.details).toMatchObject({
      endpoint: expect.stringMatching(/^127\.0\.0\.1:\d+\/v1\/chat\/completions$/),
      model: 'glm-5.3',
      status: 429,
      code: '1113',
      message: 'Insufficient balance'
    })
  })

  it('tries a candidate key without touching the stored one', async () => {
    const authorizations: (string | undefined)[] = []
    server = createServer((request, response) => {
      authorizations.push(request.headers.authorization)
      request.resume()
      request.on('end', () => {
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'bad candidate-key' } }))
      })
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    vi.stubEnv(BASE_URL_OVERRIDE_VARIABLE, `http://127.0.0.1:${port}/v1`)
    const { context, secrets } = createTestHost()
    const name = secretName.provider('openai')
    secrets.set(name, 'working-key')

    const service = new ProviderService(context, createModelResolver(context))
    const result = await service.test('openai', undefined, 'candidate-key')

    expect(authorizations).toEqual(['Bearer candidate-key'])
    expect(result.ok).toBe(false)
    expect(result.details?.message).not.toContain('candidate-key')
    expect(secrets.get(name)).toBe('working-key')
  })

  it('reads an Anthropic style body', async () => {
    const result = await testAgainst('openai', 'k', 401, {
      type: 'error',
      error: { type: 'authentication_error', message: 'invalid x-api-key' }
    })
    expect(result.details).toMatchObject({ code: 'authentication_error', status: 401 })
  })

  it('never returns the key, even when the server echoes it', async () => {
    const key = 'my-very-private-value'
    const result = await testAgainst('openai', key, 401, {
      error: { message: `Bad key ${key}`, code: key }
    })
    expect(JSON.stringify(result)).not.toContain(key)
  })

  it('reports endpoint and model on success', async () => {
    const result = await testAgainst('zai', 'key', 200, {
      id: '1',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
    })
    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.details?.model).toBe('glm-5.3')
    expect(result.details?.endpoint).toContain('127.0.0.1')
  })

  it('explains a missing key', async () => {
    const { context } = createTestHost()
    const result = await new ProviderService(context, createModelResolver(context, {})).test('zai')
    expect(result.ok).toBe(false)
    expect(result.details?.message).toContain('No API key')
    expect(result.details?.endpoint).toBe('api.z.ai/api/paas/v4')
  })
})
