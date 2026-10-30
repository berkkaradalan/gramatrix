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

function matchScore(model: ModelInfo, tokens: string[]): number {
  const name = model.name.toLowerCase()
  const id = model.id.toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (name.startsWith(token)) score += 3
    else if (name.includes(` ${token}`) || id.startsWith(token)) score += 2
    else if (name.includes(token) || id.includes(token)) score += 1
    else return 0
  }
  return score
}

/** Every word must match. Better matches come first, and the original order breaks ties. */
export function searchModels(models: ModelInfo[], query: string): ModelInfo[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return models
  return models
    .map((model) => ({ model, score: matchScore(model, tokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ model }) => model)
}
