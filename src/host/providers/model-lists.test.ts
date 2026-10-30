import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { secretName } from '@shared/rpc'
import type { ProviderId } from '@shared/types'
import { MODELS_DEV_URL, MODEL_LIST_CACHE_MS, ModelLists } from './model-lists'
import { BASE_URL_OVERRIDE_VARIABLE } from './resolve-model'

interface Route {
  status?: number
  body: unknown
}

interface RecordedRequest {
  url: string
  headers: Headers
}

const CATALOG = {
  anthropic: {
    models: {
      'claude-test': {
        id: 'claude-test',
        name: 'Claude Test',
        tool_call: true,
        reasoning: true,
        limit: { context: 200000 },
        cost: { input: 3, output: 15, cache_read: 0.3 }
      },
      'claude-old': { id: 'claude-old', name: 'Old', status: 'deprecated' }
    }
  },
  openai: {
    models: {
      'gpt-test': { id: 'gpt-test', name: 'GPT Test', tool_call: true },
      'gpt-no-tools': { id: 'gpt-no-tools', name: 'No Tools', tool_call: false },
      'text-embedding-3-small': { id: 'text-embedding-3-small', name: 'Embedding' }
    }
  },
  'alibaba-coding-plan': {
    models: {
      'glm-test': { id: 'glm-test', name: 'GLM Test', cost: { input: 0, output: 0 } }
    }
  },
  'kimi-code-plan-global': {
    models: { 'kimi-test': { id: 'kimi-test', name: 'Kimi Test' } }
  }
}

/**
 * A real HTTP server standing in for every provider. Requests keep their original URL in a
 * header, so tests can answer per URL and assert the exact endpoint without leaving localhost.
 */
class FakeNetwork {
  readonly requests: RecordedRequest[] = []
  readonly routes = new Map<string, Route>()
  private server: Server | undefined

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      const route = this.routes.get(String(request.headers['x-original-url']))
      response.writeHead(route?.status ?? (route ? 200 : 404), {
        'content-type': 'application/json'
      })
      response.end(JSON.stringify(route?.body ?? {}))
    })
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve))
  }

  stop(): void {
    this.server?.close()
  }

  get origin(): string {
    return `http://127.0.0.1:${(this.server?.address() as AddressInfo).port}`
  }

  fetch: typeof fetch = async (input, init) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    this.requests.push({ url, headers })
    headers.set('x-original-url', url)
    return fetch(`${this.origin}/`, { ...init, headers })
  }

  urls(): string[] {
    return this.requests.map(({ url }) => url)
  }
}

describe('ModelLists', () => {
  let network: FakeNetwork
  let time: number

  async function setUp(
    keys: Partial<Record<ProviderId, string>> = {},
    env: Record<string, string> = {}
  ): Promise<ModelLists> {
    network = new FakeNetwork()
    await network.start()
    time = 1000
    return new ModelLists({
      getSecret: async (name) =>
        Object.entries(keys).find(([id]) => secretName.provider(id as ProviderId) === name)?.[1] ??
        null,
      now: () => time,
      fetch: network.fetch,
      env
    })
  }

  afterEach(() => network.stop())

  describe('live lists', () => {
    it('reads OpenRouter without a key and keeps only models with tools', async () => {
      const lists = await setUp()
      network.routes.set('https://openrouter.ai/api/v1/models', {
        body: {
          data: [
            {
              id: 'a/with-tools',
              name: 'With Tools',
              context_length: 1000,
              pricing: {
                prompt: '0.000003',
                completion: '0.000015',
                input_cache_read: '0.0000003'
              },
              supported_parameters: ['tools', 'reasoning']
            },
            { id: 'b/no-tools', name: 'No Tools', supported_parameters: ['temperature'] },
            {
              id: 'openrouter/auto',
              name: 'Auto',
              pricing: { prompt: '-1', completion: '-1' },
              supported_parameters: ['tools']
            }
          ]
        }
      })

      const list = await lists.list('openrouter')

      expect(list.source).toBe('live')
      expect(list.models.map(({ id }) => id)).toEqual(['openrouter/auto', 'a/with-tools'])
      expect(list.models[1]).toEqual({
        id: 'a/with-tools',
        name: 'With Tools',
        contextWindow: 1000,
        inputPrice: 3,
        outputPrice: 15,
        cachedInputPrice: 0.3,
        supportsTools: true,
        supportsReasoning: true
      })
      expect(list.models[0]?.inputPrice).toBeNull()
      expect(network.requests[0]?.headers.has('authorization')).toBe(false)
    })

    it('calls the Anthropic list with the key header and adds catalog metadata', async () => {
      const lists = await setUp({ anthropic: 'a-key' })
      network.routes.set('https://api.anthropic.com/v1/models?limit=1000', {
        body: { data: [{ id: 'claude-test', display_name: 'From API' }], has_more: false }
      })
      network.routes.set(MODELS_DEV_URL, { body: CATALOG })

      const list = await lists.list('anthropic')

      expect(list.source).toBe('live')
      expect(list.models[0]).toEqual({
        id: 'claude-test',
        name: 'Claude Test',
        contextWindow: 200000,
        inputPrice: 3,
        outputPrice: 15,
        cachedInputPrice: 0.3,
        supportsTools: true,
        supportsReasoning: true
      })
      const [request] = network.requests
      expect(request?.headers.get('x-api-key')).toBe('a-key')
      expect(request?.headers.get('anthropic-version')).toBe('2023-06-01')
    })

    it('follows Anthropic style pages', async () => {
      const lists = await setUp({ minimax: 'key' })
      const base = 'https://api.minimax.io/anthropic/v1/models?limit=1000'
      network.routes.set(base, {
        body: { data: [{ id: 'one' }], has_more: true, last_id: 'one' }
      })
      network.routes.set(`${base}&after_id=one`, {
        body: { data: [{ id: 'two' }], has_more: false }
      })
      const list = await lists.list('minimax')
      expect(list.models.map(({ id }) => id)).toEqual(['one', 'two'])
    })

    it('calls an OpenAI style list with a bearer token at the plan endpoint', async () => {
      const lists = await setUp({ 'alibaba-coding-plan': 'plan-key' })
      network.routes.set('https://coding-intl.dashscope.aliyuncs.com/v1/models', {
        body: { data: [{ id: 'glm-test' }, { id: 'glm-unknown' }] }
      })
      network.routes.set(MODELS_DEV_URL, { body: CATALOG })

      const list = await lists.list('alibaba-coding-plan')

      expect(list.source).toBe('live')
      expect(network.requests[0]?.headers.get('authorization')).toBe('Bearer plan-key')
      expect(list.models.map(({ name }) => name)).toEqual(['GLM Test', 'glm-unknown'])
      expect(list.models[0]?.inputPrice).toBeNull()
      expect(list.models[1]?.supportsTools).toBe(true)
    })

    it('finds Kimi metadata under its models.dev id', async () => {
      const lists = await setUp({ 'kimi-coding-plan': 'key' })
      network.routes.set('https://api.kimi.ai/coding/v1/models', {
        body: { data: [{ id: 'kimi-test' }] }
      })
      network.routes.set(MODELS_DEV_URL, { body: CATALOG })
      expect((await lists.list('kimi-coding-plan')).models[0]?.name).toBe('Kimi Test')
    })

    it('filters models that cannot chat from OpenAI, but keeps others', async () => {
      const lists = await setUp({ openai: 'key' })
      const ids = [
        'gpt-test',
        'text-embedding-3-small',
        'gpt-audio-1',
        'tts-1',
        'whisper-1',
        'gpt-image-1',
        'omni-moderation-latest',
        'gpt-realtime',
        'gpt-transcribe',
        'dall-e-3'
      ]
      network.routes.set('https://api.openai.com/v1/models', {
        body: { data: ids.map((id) => ({ id })) }
      })
      network.routes.set(MODELS_DEV_URL, { body: CATALOG })
      const list = await lists.list('openai')
      expect(list.models.map(({ id }) => id)).toEqual(['gpt-test'])
    })

    it('keeps models without tool support but marks them', async () => {
      const lists = await setUp({ openai: 'key' })
      network.routes.set('https://api.openai.com/v1/models', {
        body: { data: [{ id: 'gpt-no-tools' }] }
      })
      network.routes.set(MODELS_DEV_URL, { body: CATALOG })
      expect((await lists.list('openai')).models).toMatchObject([
        { id: 'gpt-no-tools', supportsTools: false }
      ])
    })

    it('puts the default model first', async () => {
      const lists = await setUp({ zai: 'key' })
      network.routes.set('https://api.z.ai/api/paas/v4/models', {
        body: { data: [{ id: 'aaa' }, { id: 'glm-5.3' }] }
      })
      expect((await lists.list('zai')).models.map(({ id }) => id)).toEqual(['glm-5.3', 'aaa'])
    })

    it('uses the snapshot for metadata when models.dev is down', async () => {
      const lists = await setUp({ zai: 'key' })
      network.routes.set('https://api.z.ai/api/paas/v4/models', {
        body: { data: [{ id: 'glm-5.3' }] }
      })
      network.routes.set(MODELS_DEV_URL, { status: 503, body: {} })
      const list = await lists.list('zai')
      expect(list.source).toBe('live')
      expect(list.models[0]?.name).not.toBe('glm-5.3')
      expect(list.models[0]?.contextWindow).toBeGreaterThan(0)
    })
  })

  describe('model allowlists', () => {
    const PLAN_MODELS = ['glm-5.3', 'glm-5.3-flash']

    it.each(['zai-coding-plan', 'zhipu-coding-plan'] as const)(
      'never lets a live list add models to %s',
      async (provider) => {
        const lists = await setUp({ [provider]: 'key' })
        const url =
          provider === 'zai-coding-plan'
            ? 'https://api.z.ai/api/coding/paas/v4/models'
            : 'https://open.bigmodel.cn/api/coding/paas/v4/models'
        network.routes.set(url, {
          body: { data: [{ id: 'glm-5.3' }, { id: 'glm-5.2' }, { id: 'glm-4.7' }] }
        })
        const list = await lists.list(provider)
        expect(list.source).toBe('live')
        expect(list.models.map(({ id }) => id)).toEqual(['glm-5.3'])
      }
    )

    it('matches ids whatever their letter case', async () => {
      const lists = await setUp({ 'zai-coding-plan': 'key' })
      network.routes.set('https://api.z.ai/api/coding/paas/v4/models', {
        body: { data: [{ id: 'GLM-5.3-Flash' }] }
      })
      expect((await lists.list('zai-coding-plan')).models.map(({ id }) => id)).toEqual([
        'GLM-5.3-Flash'
      ])
    })

    it('falls back when a live list has only other models', async () => {
      const lists = await setUp({ 'zai-coding-plan': 'key' })
      network.routes.set('https://api.z.ai/api/coding/paas/v4/models', {
        body: { data: [{ id: 'glm-5.2' }] }
      })
      const list = await lists.list('zai-coding-plan')
      expect(list.source).toBe('snapshot')
      expect(list.models.map(({ id }) => id)).toEqual(PLAN_MODELS)
    })

    it('narrows the catalog fallback', async () => {
      const lists = await setUp()
      network.routes.set(MODELS_DEV_URL, {
        body: {
          'zai-coding-plan': {
            models: {
              'glm-5.3': { id: 'glm-5.3' },
              'glm-5.3-highspeed': { id: 'glm-5.3-highspeed' }
            }
          }
        }
      })
      const list = await lists.list('zai-coding-plan')
      expect(list.source).toBe('catalog')
      expect(list.models.map(({ id }) => id)).toEqual(['glm-5.3'])
    })

    it('narrows the snapshot fallback', async () => {
      const lists = await setUp()
      const list = await lists.list('zhipu-coding-plan')
      expect(list.source).toBe('snapshot')
      expect(list.models.map(({ id }) => id)).toEqual(PLAN_MODELS)
    })
  })

  describe('fallbacks', () => {
    it('never calls a keyed endpoint without a key', async () => {
      const lists = await setUp()
      network.routes.set(MODELS_DEV_URL, { body: CATALOG })
      const list = await lists.list('anthropic')
      expect(list.source).toBe('catalog')
      expect(network.urls()).toEqual([MODELS_DEV_URL])
    })

    it('falls back to models.dev when the key is rejected, without deprecated models', async () => {
      const lists = await setUp({ anthropic: 'bad' })
      network.routes.set('https://api.anthropic.com/v1/models?limit=1000', {
        status: 401,
        body: { error: 'nope' }
      })
      network.routes.set(MODELS_DEV_URL, { body: CATALOG })
      const list = await lists.list('anthropic')
      expect(list.source).toBe('catalog')
      expect(list.models.map(({ id }) => id)).toEqual(['claude-test'])
    })

    it('falls back when the provider answers with nothing', async () => {
      const lists = await setUp({ openai: 'key' })
      network.routes.set('https://api.openai.com/v1/models', { body: { data: [] } })
      network.routes.set(MODELS_DEV_URL, { body: CATALOG })
      const list = await lists.list('openai')
      expect(list.source).toBe('catalog')
      expect(list.models.map(({ id }) => id)).not.toContain('text-embedding-3-small')
    })

    it('falls back when the provider answers with an unexpected shape', async () => {
      const lists = await setUp({ openai: 'key' })
      network.routes.set('https://api.openai.com/v1/models', { body: { models: 'surprise' } })
      network.routes.set(MODELS_DEV_URL, { body: CATALOG })
      expect((await lists.list('openai')).source).toBe('catalog')
    })

    it('falls back to the snapshot when everything fails', async () => {
      const lists = await setUp({ zai: 'key' })
      const list = await lists.list('zai')
      expect(list.source).toBe('snapshot')
      expect(list.models.length).toBeGreaterThan(0)
    })

    it('never shows an empty picker when the network is gone', async () => {
      const lists = await setUp({ anthropic: 'key' })
      network.fetch = async () => {
        throw new TypeError('fetch failed')
      }
      const offline = new ModelLists({
        getSecret: async () => 'key',
        now: () => time,
        fetch: network.fetch,
        env: {}
      })
      for (const provider of ['anthropic', 'openrouter', 'kimi-coding-plan'] as const) {
        const list = await offline.list(provider)
        expect(list.source).toBe('snapshot')
        expect(list.models.length).toBeGreaterThan(0)
      }
      await lists.list('zai')
    })

    it('falls back for OpenRouter too', async () => {
      const lists = await setUp()
      network.routes.set(MODELS_DEV_URL, {
        body: { openrouter: { models: { 'x/y': { id: 'x/y', name: 'XY' } } } }
      })
      const list = await lists.list('openrouter')
      expect(list.source).toBe('catalog')
      expect(list.models.map(({ id }) => id)).toEqual(['x/y'])
    })
  })

  describe('cache', () => {
    async function setUpCached(): Promise<ModelLists> {
      const lists = await setUp({ zai: 'key' })
      network.routes.set('https://api.z.ai/api/paas/v4/models', {
        body: { data: [{ id: 'first' }] }
      })
      network.routes.set(MODELS_DEV_URL, { body: CATALOG })
      return lists
    }

    function modelRequests(): number {
      return network.urls().filter((url) => url.startsWith('https://api.z.ai')).length
    }

    it('serves repeat calls from memory', async () => {
      const lists = await setUpCached()
      await lists.list('zai')
      await lists.list('zai')
      expect(modelRequests()).toBe(1)
    })

    it('asks again after an hour', async () => {
      const lists = await setUpCached()
      await lists.list('zai')
      time += MODEL_LIST_CACHE_MS + 1
      await lists.list('zai')
      expect(modelRequests()).toBe(2)
    })

    it('bypasses the cache on refresh', async () => {
      const lists = await setUpCached()
      await lists.list('zai')
      network.routes.set('https://api.z.ai/api/paas/v4/models', {
        body: { data: [{ id: 'second' }] }
      })
      const list = await lists.list('zai', true)
      expect(list.models.map(({ id }) => id)).toEqual(['second'])
    })

    it('keeps providers apart', async () => {
      const lists = await setUpCached()
      await lists.list('zai')
      await lists.list('zai-coding-plan')
      expect(network.urls()).toContain('https://models.dev/api.json')
      expect((await lists.list('zai')).models[0]?.id).toBe('first')
    })

    it('does not keep a list made without a key once a key exists', async () => {
      let key: string | null = null
      network = new FakeNetwork()
      await network.start()
      network.routes.set('https://api.z.ai/api/paas/v4/models', {
        body: { data: [{ id: 'live-model' }] }
      })
      const lists = new ModelLists({
        getSecret: async () => key,
        now: () => 1000,
        fetch: network.fetch,
        env: {}
      })
      expect((await lists.list('zai')).source).toBe('snapshot')
      key = 'new-key'
      expect((await lists.list('zai')).source).toBe('live')
    })
  })

  describe('base URL override', () => {
    it('sends the list call to the override, for every provider, and skips models.dev', async () => {
      const lists = await setUp(
        { openrouter: 'key', anthropic: 'key' },
        { [BASE_URL_OVERRIDE_VARIABLE]: 'http://fake.invalid/v1' }
      )
      network.routes.set('http://fake.invalid/v1/models', { body: { data: [{ id: 'fake' }] } })

      expect((await lists.list('openrouter')).models.map(({ id }) => id)).toEqual(['fake'])
      expect((await lists.list('anthropic')).source).toBe('live')
      expect(new Set(network.urls())).toEqual(new Set(['http://fake.invalid/v1/models']))
    })

    it('stays offline when the override has no key to use', async () => {
      const lists = await setUp({}, { [BASE_URL_OVERRIDE_VARIABLE]: 'http://fake.invalid/v1' })
      expect((await lists.list('zai')).source).toBe('snapshot')
      expect(network.urls()).toEqual([])
    })
  })
})
