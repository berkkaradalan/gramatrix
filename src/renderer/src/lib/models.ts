import type { ModelInfo, ModelRef } from '@shared/types'

const MAX_RECENT_MODELS = 5

export function modelKey(ref: ModelRef): string {
  return `${ref.provider}::${ref.model}`
}

export function sameModel(a: ModelRef | null, b: ModelRef | null): boolean {
  return a !== null && b !== null && a.provider === b.provider && a.model === b.model
}

/** Drops the vendor prefix of router style ids, such as `openai/gpt-x`. */
export function shortModelName(id: string): string {
  return id.split('/').at(-1) ?? id
}

export function formatContext(tokens: number | null): string {
  if (tokens === null) return ''
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`
  return `${Math.round(tokens / 1000)}K`
}

function formatDollars(amount: number): string {
  if (Number.isInteger(amount)) return `$${amount}`
  return `$${amount.toFixed(amount < 0.01 ? 3 : 2)}`
}

/** Input and output price per million tokens, or an empty string when unknown. */
export function formatPrice(model: Pick<ModelInfo, 'inputPrice' | 'outputPrice'>): string {
  const { inputPrice, outputPrice } = model
  if (inputPrice === null || outputPrice === null) return ''
  if (inputPrice === 0 && outputPrice === 0) return 'Free'
  return `${formatDollars(inputPrice)} / ${formatDollars(outputPrice)}`
}

export function toggleModel(list: ModelRef[], ref: ModelRef): ModelRef[] {
  const present = list.some((item) => sameModel(item, ref))
  return present ? list.filter((item) => !sameModel(item, ref)) : [...list, ref]
}

export function pushRecentModel(list: ModelRef[], ref: ModelRef): ModelRef[] {
  return [ref, ...list.filter((item) => !sameModel(item, ref))].slice(0, MAX_RECENT_MODELS)
}

/** Letters and digits only, so "Z.ai", "z-ai" and "zai" read the same. */
function compact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** The provider a list belongs to. A word that names it matches every model of that provider. */
export interface SearchProvider {
  id: string
  label: string
}

function matchScore(model: ModelInfo, tokens: string[], provider: string): number {
  const name = model.name.toLowerCase()
  const id = model.id.toLowerCase()
  let score = 0
  for (const token of tokens) {
    const word = compact(token)
    if (name.startsWith(token)) score += 3
    else if (name.includes(` ${token}`) || id.startsWith(token)) score += 2
    else if (name.includes(token) || id.includes(token)) score += 1
    else if (word && (compact(name).includes(word) || compact(id).includes(word))) score += 1
    else if (word && provider.includes(word)) score += 1
    else return 0
  }
  return score
}

/**
 * Every word must match the model or, when `provider` is given, its provider. Better matches come
 * first, and the original order breaks ties.
 */
export function searchModels(
  models: ModelInfo[],
  query: string,
  provider?: SearchProvider
): ModelInfo[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return models
  const providerText = provider ? compact(`${provider.label} ${provider.id}`) : ''
  return models
    .map((model) => ({ model, score: matchScore(model, tokens, providerText) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ model }) => model)
}

/**
 * Whether a search could be a model id typed by hand, such as "glm-5.3" or "x-ai/grok-5". Dots and
 * dashes alone do not count, since "z.ai" and "z-ai" are provider names.
 */
export function looksLikeModelId(query: string): boolean {
  return !/\s/.test(query) && /[/:0-9]/.test(query)
}
