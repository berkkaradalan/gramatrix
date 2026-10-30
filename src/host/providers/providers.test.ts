import { afterEach, describe, expect, it, vi } from 'vitest'
import { secretName } from '@shared/rpc'
import { PROVIDER_IDS, type ProviderId } from '@shared/types'
import { scriptedModel } from '../agent/testing'
import { createTestHost } from '../testing'
import { PROVIDERS, providerEntry, wrongEntryHint } from './catalog'
import { parseModelCatalog } from './model-catalog'
import { ModelLists } from './model-lists'
import snapshot from './models-snapshot.json'
import { ProviderService } from './provider-service'
import { BASE_URL_OVERRIDE_VARIABLE, createModelResolver } from './resolve-model'

function getSecretWith(key: string | null): { getSecret(): Promise<string | null> } {
  return { getSecret: async () => key }
}

interface ChatModel {
  doGenerate(options: unknown): Promise<unknown>
}

/** Makes one request with fetch stubbed, and returns what would have been sent. */
async function captureRequest(
  provider: ProviderId,
  env: Record<string, string> = {}
): Promise<{ url: string; headers: Headers }> {
  const requests: { url: string; headers: Headers }[] = []
  vi.stubGlobal('fetch', async (url: unknown, init: RequestInit) => {
    requests.push({ url: String(url), headers: new Headers(init.headers) })
    return new Response('{}', { status: 500 })
  })
  const resolve = createModelResolver(getSecretWith('the-key'), env)
  const model = (await resolve({ provider, model: 'some-model' })) as unknown as ChatModel
  await model
    .doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
    })
    .catch(() => undefined)
  const request = requests[0]
  if (!request) throw new Error('No request was made.')
  return request
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('catalog', () => {
  it('describes every provider', () => {
    expect(PROVIDERS.map((provider) => provider.id).sort()).toEqual([...PROVIDER_IDS].sort())
    for (const provider of PROVIDERS) {
      expect(provider.keyUrl).toMatch(/^https:\/\//)
      expect(provider.baseUrl).toMatch(/^https:\/\//)
      expect(provider.hint.length).toBeGreaterThan(0)
    }
  })

  it('has a bundled model list for every provider, including its default model', () => {
    const bundled = snapshot as Record<string, { models: Record<string, unknown> }>
    for (const provider of PROVIDERS) {
      expect(Object.keys(bundled[provider.modelsDevId]?.models ?? {})).toContain(
        provider.defaultModel
      )
    }
  })

  it('bundles a snapshot the catalog parser accepts', () => {
    expect(parseModelCatalog(snapshot)).not.toBeNull()
  })

  it('separates plans from pay as you go entries', () => {
    const plans = PROVIDERS.filter(({ kind }) => kind === 'plan').map(({ id }) => id)
    expect(plans.sort()).toEqual([
      'alibaba-coding-plan',
      'kimi-coding-plan',
      'minimax-coding-plan',
      'zai-coding-plan',
      'zhipu-coding-plan'
    ])
  })
})

describe('wrongEntryHint', () => {
  it('names the plan entry for a plan key on the pay as you go entry', () => {
    expect(wrongEntryHint('minimax', 'sk-cp-123')).toContain('MiniMax Token Plan')
    expect(wrongEntryHint('minimax', 'sk-api-123')).toBeNull()
  })

  it('names the pay as you go entry for a regular key on the plan entry', () => {
    expect(wrongEntryHint('minimax-coding-plan', 'sk-api-123')).toContain('MiniMax API')
    expect(wrongEntryHint('minimax-coding-plan', 'sk-cp-123')).toBeNull()
  })

  it('points the pay as you go Z.ai entry at the plan, because their keys look alike', () => {
    expect(wrongEntryHint('zai', 'abc')).toContain('Z.ai Coding Plan')
  })

  it('flags a general key on the Alibaba plan', () => {
    expect(wrongEntryHint('alibaba-coding-plan', 'sk-123')).toContain('sk-sp-')
    expect(wrongEntryHint('alibaba-coding-plan', 'sk-sp-123')).toBeNull()
  })

  it('stays quiet for providers with a single entry', () => {
    expect(wrongEntryHint('openai', 'anything')).toBeNull()
  })
})

describe('createModelResolver', () => {
  it.each<[ProviderId, string]>([
    ['anthropic', 'https://api.anthropic.com/v1/messages'],
    ['openai', 'https://api.openai.com/v1/responses'],
    ['openrouter', 'https://openrouter.ai/api/v1/chat/completions'],
    ['zai', 'https://api.z.ai/api/paas/v4/chat/completions'],
    ['minimax', 'https://api.minimax.io/anthropic/v1/messages'],
    ['zai-coding-plan', 'https://api.z.ai/api/coding/paas/v4/chat/completions'],
    ['zhipu-coding-plan', 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions'],
    ['minimax-coding-plan', 'https://api.minimax.io/anthropic/v1/messages'],
    ['kimi-coding-plan', 'https://api.kimi.ai/coding/v1/chat/completions'],
    ['alibaba-coding-plan', 'https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions']
  ])('sends %s to its endpoint', async (provider, url) => {
    expect((await captureRequest(provider)).url).toBe(url)
  })

  it.each<ProviderId>(['anthropic', 'minimax', 'minimax-coding-plan'])(
    'authenticates %s the Anthropic way',
    async (provider) => {
      expect((await captureRequest(provider)).headers.get('x-api-key')).toBe('the-key')
    }
  )

  it.each<ProviderId>(['openai', 'zai', 'zai-coding-plan', 'kimi-coding-plan'])(
    'authenticates %s with a bearer token',
    async (provider) => {
      const { headers } = await captureRequest(provider)
      expect(headers.get('authorization')).toBe('Bearer the-key')
    }
  )

  it('explains a missing key', async () => {
    const resolve = createModelResolver(getSecretWith(null), {})
    await expect(resolve({ provider: 'zai', model: 'x' })).rejects.toThrow(
      `No API key is set for ${providerEntry('zai').label}.`
    )
  })

  it('asks compatible servers to report token use on streams', async () => {
    let body = ''
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      body = String(init.body)
      return new Response('{}', { status: 500 })
    })
    const resolve = createModelResolver(getSecretWith('key'), {})
    const model = (await resolve({ provider: 'zai', model: 'm' })) as unknown as {
      doStream(options: unknown): Promise<unknown>
    }
    await model
      .doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })
      .catch(() => undefined)
    expect(JSON.parse(body).stream_options).toEqual({ include_usage: true })
  })

  it('asks OpenRouter to report the cost', async () => {
    let body = ''
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      body = String(init.body)
      return new Response('{}', { status: 500 })
    })
    const resolve = createModelResolver(getSecretWith('key'), {})
    const model = (await resolve({ provider: 'openrouter', model: 'a/b' })) as unknown as ChatModel
    await model
      .doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })
      .catch(() => undefined)
    expect(JSON.parse(body).usage).toEqual({ include: true })
  })

  it('reads the key stored for that entry', async () => {
    const requested: string[] = []
    const resolve = createModelResolver(
      {
        getSecret: async (name) => {
          requested.push(name)
          return 'key'
        }
      },
      {}
    )
    await resolve({ provider: 'minimax-coding-plan', model: 'x' })
    expect(requested).toEqual([secretName.provider('minimax-coding-plan')])
  })

  it.each(PROVIDER_IDS)('sends %s to the override when one is set', async (provider) => {
    const { url } = await captureRequest(provider, {
      [BASE_URL_OVERRIDE_VARIABLE]: 'http://127.0.0.1:9/v1'
    })
    expect(url).toBe('http://127.0.0.1:9/v1/chat/completions')
  })
})

describe('ProviderService', () => {
  it('reports which providers have a key without exposing it', async () => {
    const { context, secrets } = createTestHost()
    secrets.set(secretName.provider('openai'), 'sk-secret')
    const service = new ProviderService(context, createModelResolver(context, {}))
    const list = await service.list()
    expect(list.find(({ id }) => id === 'openai')?.configured).toBe(true)
    expect(list.find(({ id }) => id === 'zai')?.configured).toBe(false)
    expect(JSON.stringify(list)).not.toContain('sk-secret')
  })

  it('does not send transport details to the renderer', async () => {
    const { context } = createTestHost()
    const service = new ProviderService(context, createModelResolver(context, {}))
    const [first] = await service.list()
    expect(Object.keys(first ?? {}).sort()).toEqual([
      'configured',
      'defaultModel',
      'hint',
      'id',
      'keyUrl',
      'kind',
      'label',
      'logo'
    ])
  })

  it('serves model lists through the router', async () => {
    const { context } = createTestHost()
    const lists = new ModelLists({
      ...context,
      fetch: async () => new Response('', { status: 500 })
    })
    const service = new ProviderService(context, createModelResolver(context, {}), lists)
    const list = await service.models('zai')
    expect(list.source).toBe('snapshot')
    expect(list.models.length).toBeGreaterThan(0)
  })

  it('reports a working key', async () => {
    const { context } = createTestHost()
    const service = new ProviderService(context, async () => scriptedModel([{ text: 'ok' }]))
    await expect(service.test('openai')).resolves.toMatchObject({ ok: true })
  })

  it('reports the reason for a failure', async () => {
    const { context } = createTestHost()
    const service = new ProviderService(context, createModelResolver(context, {}))
    const result = await service.test('anthropic')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('No API key')
  })

  it('tests the default model unless told otherwise', async () => {
    const { context } = createTestHost()
    const models: string[] = []
    const service = new ProviderService(context, async ({ model }) => {
      models.push(model)
      return scriptedModel([{ text: 'ok' }])
    })
    await service.test('minimax')
    await service.test('minimax', 'other')
    expect(models).toEqual([providerEntry('minimax').defaultModel, 'other'])
  })
})
