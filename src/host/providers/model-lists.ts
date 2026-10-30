import { z } from 'zod'
import { secretName } from '@shared/rpc'
import type { ModelInfo, ModelList, ModelListSource, ProviderId } from '@shared/types'
import type { HostContext } from '../context'
import { providerEntry, type ProviderEntry } from './catalog'
import { catalogModels, parseModelCatalog, type ModelCatalog } from './model-catalog'
import snapshot from './models-snapshot.json'
import { BASE_URL_OVERRIDE_VARIABLE } from './resolve-model'

export const MODEL_LIST_CACHE_MS = 60 * 60 * 1000
export const MODELS_DEV_URL = 'https://models.dev/api.json'
const REQUEST_TIMEOUT_MS = 8000
const ANTHROPIC_API_VERSION = '2023-06-01'
const MAX_ANTHROPIC_PAGES = 10

/** The OpenAI list also holds models that cannot chat, and it has no field that says so. */
const OPENAI_NON_CHAT_MODEL =
  /embedding|audio|tts|whisper|image|moderation|realtime|transcribe|dall-e|sora|davinci|babbage/i

const openAiListSchema = z.object({
  data: z.array(z.looseObject({ id: z.string(), name: z.string().optional() }))
})

const anthropicListSchema = z.object({
  data: z.array(z.looseObject({ id: z.string(), display_name: z.string().optional() })),
  has_more: z.boolean().optional(),
  last_id: z.string().nullish()
})

const openRouterListSchema = z.object({
  data: z.array(
    z.looseObject({
      id: z.string(),
      name: z.string().optional(),
      context_length: z.number().nullish(),
      pricing: z
        .looseObject({
          prompt: z.string(),
          completion: z.string(),
          input_cache_read: z.string().optional()
        })
        .optional(),
      supported_parameters: z.array(z.string()).optional()
    })
  )
})

/** A model seen on a live list, before metadata is merged in. */
interface LiveModel {
  id: string
  name?: string
}

interface CacheEntry {
  list: ModelList
  expiresAt: number
  /** Whether a key was stored. Adding a key must not wait for a keyless list to expire. */
  hadKey: boolean
}

export interface ModelListDependencies extends Pick<HostContext, 'getSecret' | 'now'> {
  fetch?: typeof fetch
  env?: Record<string, string | undefined>
}

/** OpenRouter prices are US dollars per token as text. Router entries use -1 for "varies". */
function pricePerMillion(perToken: string | undefined): number | null {
  const price = Number(perToken)
  if (perToken === undefined || Number.isNaN(price) || price < 0) return null
  return Math.round(price * 1e6 * 1e6) / 1e6
}

function toUnknownModel(id: string): ModelInfo {
  return unknownModel({ id })
}

function unknownModel({ id, name }: LiveModel): ModelInfo {
  return {
    id,
    name: name ?? id,
    contextWindow: null,
    inputPrice: null,
    outputPrice: null,
    supportsTools: true,
    supportsReasoning: false
  }
}

function sortModels(models: ModelInfo[], defaultModel: string): ModelInfo[] {
  return [...models].sort((a, b) => {
    if (a.id === defaultModel) return -1
    if (b.id === defaultModel) return 1
    return a.name.localeCompare(b.name)
  })
}

/**
 * Builds model pickers. Asks the provider first, then falls back to models.dev and finally to the
 * snapshot in the app, so being offline can never leave a picker empty.
 */
export class ModelLists {
  private readonly cache = new Map<ProviderId, CacheEntry>()
  private catalogCache: { catalog: ModelCatalog; expiresAt: number } | null = null
  private readonly fetchJson: typeof fetch
  private readonly env: Record<string, string | undefined>

  constructor(private readonly dependencies: ModelListDependencies) {
    this.fetchJson = dependencies.fetch ?? ((input, init) => fetch(input, init))
    this.env = dependencies.env ?? process.env
  }

  async list(provider: ProviderId, refresh = false): Promise<ModelList> {
    const hadKey = (await this.dependencies.getSecret(secretName.provider(provider))) !== null
    const cached = this.cache.get(provider)
    if (
      !refresh &&
      cached &&
      cached.hadKey === hadKey &&
      cached.expiresAt > this.dependencies.now()
    ) {
      return cached.list
    }

    const list = await this.build(providerEntry(provider))
    const expiresAt = this.dependencies.now() + MODEL_LIST_CACHE_MS
    this.cache.set(provider, { list, expiresAt, hadKey })
    return list
  }

  private async build(entry: ProviderEntry): Promise<ModelList> {
    const override = this.env[BASE_URL_OVERRIDE_VARIABLE]
    if (entry.transport === 'openrouter' && !override) {
      const live = await this.fetchOpenRouter(entry)
      return this.usable(entry, live).length > 0
        ? this.finish(entry, live, 'live')
        : this.fallback(entry)
    }

    const live = await this.fetchLive(entry, override)
    if (this.usableIds(entry, live).length === 0) return this.fallback(entry)

    const catalog = (await this.loadCatalog(override)) ?? (snapshot as ModelCatalog)
    const known = new Map(
      catalogModels(catalog, entry.modelsDevId, entry.kind).map((model) => [model.id, model])
    )
    const merged = live.map((model) => known.get(model.id) ?? unknownModel(model))
    return this.finish(entry, merged, 'live')
  }

  private async fallback(entry: ProviderEntry): Promise<ModelList> {
    const catalog = await this.loadCatalog(this.env[BASE_URL_OVERRIDE_VARIABLE])
    const models = catalog ? catalogModels(catalog, entry.modelsDevId, entry.kind) : []
    if (models.length > 0) return this.finish(entry, models, 'catalog')
    const bundled = snapshot as ModelCatalog
    return this.finish(entry, catalogModels(bundled, entry.modelsDevId, entry.kind), 'snapshot')
  }

  private finish(entry: ProviderEntry, models: ModelInfo[], source: ModelListSource): ModelList {
    const usable = this.usable(entry, models)
    // The allowlist is a fact from the vendor, so it stays offered if every list missed it.
    const offered = usable.length > 0 ? usable : (entry.allowedModels ?? []).map(toUnknownModel)
    return { models: sortModels(offered, entry.defaultModel), source }
  }

  private usable(entry: ProviderEntry, models: ModelInfo[]): ModelInfo[] {
    const ids = new Set(this.usableIds(entry, models).map(({ id }) => id))
    return models.filter(({ id }) => ids.has(id))
  }

  private usableIds<Model extends LiveModel>(entry: ProviderEntry, models: Model[]): Model[] {
    if (entry.transport === 'openai') {
      return models.filter((model) => !OPENAI_NON_CHAT_MODEL.test(model.id))
    }
    const allowed = entry.allowedModels?.map((id) => id.toLowerCase())
    if (!allowed) return models
    return models.filter((model) => allowed.includes(model.id.toLowerCase()))
  }

  private async fetchLive(
    entry: ProviderEntry,
    override: string | undefined
  ): Promise<LiveModel[]> {
    const apiKey = await this.dependencies.getSecret(secretName.provider(entry.id))
    if (!apiKey) return []
    if (override) return this.fetchOpenAiStyle(override, apiKey)
    return entry.transport === 'anthropic' || entry.transport === 'anthropic-compatible'
      ? this.fetchAnthropicStyle(entry.baseUrl, apiKey)
      : this.fetchOpenAiStyle(entry.baseUrl, apiKey)
  }

  private async fetchOpenAiStyle(baseUrl: string, apiKey: string): Promise<LiveModel[]> {
    const data = await this.getJson(`${baseUrl}/models`, { authorization: `Bearer ${apiKey}` })
    return openAiListSchema.safeParse(data).data?.data ?? []
  }

  private async fetchAnthropicStyle(baseUrl: string, apiKey: string): Promise<LiveModel[]> {
    const headers = { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_API_VERSION }
    const models: LiveModel[] = []
    let afterId: string | null | undefined
    for (let page = 0; page < MAX_ANTHROPIC_PAGES; page++) {
      const query = `limit=1000${afterId ? `&after_id=${encodeURIComponent(afterId)}` : ''}`
      const data = await this.getJson(`${baseUrl}/models?${query}`, headers)
      const parsed = anthropicListSchema.safeParse(data)
      if (!parsed.success) break
      models.push(...parsed.data.data.map(({ id, display_name }) => ({ id, name: display_name })))
      if (!parsed.data.has_more || !parsed.data.last_id) break
      afterId = parsed.data.last_id
    }
    return models
  }

  /** Public, and has everything needed. Models that cannot use tools cannot run the agent. */
  private async fetchOpenRouter(entry: ProviderEntry): Promise<ModelInfo[]> {
    const parsed = openRouterListSchema.safeParse(await this.getJson(`${entry.baseUrl}/models`))
    return (parsed.data?.data ?? [])
      .filter((model) => model.supported_parameters?.includes('tools'))
      .map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
        contextWindow: model.context_length ?? null,
        inputPrice: pricePerMillion(model.pricing?.prompt),
        outputPrice: pricePerMillion(model.pricing?.completion),
        cachedInputPrice: pricePerMillion(model.pricing?.input_cache_read),
        supportsTools: true,
        supportsReasoning: model.supported_parameters?.includes('reasoning') ?? false
      }))
  }

  private async loadCatalog(override: string | undefined): Promise<ModelCatalog | null> {
    // End to end tests must not reach the network.
    if (override) return null
    const cached = this.catalogCache
    if (cached && cached.expiresAt > this.dependencies.now()) return cached.catalog
    const catalog = parseModelCatalog(await this.getJson(MODELS_DEV_URL))
    if (catalog) {
      const expiresAt = this.dependencies.now() + MODEL_LIST_CACHE_MS
      this.catalogCache = { catalog, expiresAt }
    }
    return catalog
  }

  /** Returns null on any failure, because every caller has a fallback. */
  private async getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
    try {
      const response = await this.fetchJson(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      return response.ok ? await response.json() : null
    } catch {
      return null
    }
  }
}
