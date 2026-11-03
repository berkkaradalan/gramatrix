import { describe, expect, it } from 'vitest'
import type { ModelInfo, ModelRef } from '@shared/types'
import {
  formatContext,
  formatPrice,
  pushRecentModel,
  looksLikeModelId,
  searchModels,
  shortModelName,
  toggleModel
} from './models'

function model(id: string, name = id): ModelInfo {
  return {
    id,
    name,
    contextWindow: null,
    inputPrice: null,
    outputPrice: null,
    supportsTools: true,
    supportsReasoning: false
  }
}

const a: ModelRef = { provider: 'openai', model: 'a' }
const b: ModelRef = { provider: 'openai', model: 'b' }

describe('shortModelName', () => {
  it('drops the vendor prefix', () => {
    expect(shortModelName('anthropic/claude-sonnet')).toBe('claude-sonnet')
    expect(shortModelName('glm-5')).toBe('glm-5')
  })
})

describe('formatContext', () => {
  it('uses thousands and millions', () => {
    expect(formatContext(200_000)).toBe('200K')
    expect(formatContext(1_000_000)).toBe('1M')
    expect(formatContext(1_500_000)).toBe('1.5M')
    expect(formatContext(null)).toBe('')
  })
})

describe('formatPrice', () => {
  it('shows input and output', () => {
    expect(formatPrice({ inputPrice: 3, outputPrice: 15 })).toBe('$3 / $15')
    expect(formatPrice({ inputPrice: 0.25, outputPrice: 1.25 })).toBe('$0.25 / $1.25')
    expect(formatPrice({ inputPrice: 0.8, outputPrice: 4 })).toBe('$0.80 / $4')
    expect(formatPrice({ inputPrice: 0.005, outputPrice: 0.015 })).toBe('$0.005 / $0.01')
  })

  it('names free models and hides unknown prices', () => {
    expect(formatPrice({ inputPrice: 0, outputPrice: 0 })).toBe('Free')
    expect(formatPrice({ inputPrice: null, outputPrice: null })).toBe('')
  })
})

describe('toggleModel', () => {
  it('adds and removes', () => {
    expect(toggleModel([a], b)).toEqual([a, b])
    expect(toggleModel([a, b], a)).toEqual([b])
  })
})

describe('pushRecentModel', () => {
  it('moves a model to the front without duplicates', () => {
    expect(pushRecentModel([a, b], b)).toEqual([b, a])
  })

  it('keeps the list short', () => {
    const list = ['1', '2', '3', '4', '5'].map((id) => ({ provider: 'openai' as const, model: id }))
    expect(pushRecentModel(list, a)).toHaveLength(5)
  })
})

describe('searchModels', () => {
  const models = [model('x/gpt-mini', 'GPT Mini'), model('y/claude', 'Claude'), model('z/mini-gpt')]

  it('returns everything without a query', () => {
    expect(searchModels(models, '  ')).toEqual(models)
  })

  it('requires every word', () => {
    expect(searchModels(models, 'gpt claude')).toEqual([])
  })

  it('ranks name prefixes first', () => {
    expect(searchModels(models, 'gpt').map(({ id }) => id)).toEqual(['x/gpt-mini', 'z/mini-gpt'])
  })

  it('searches ids', () => {
    expect(searchModels(models, 'y/').map(({ id }) => id)).toEqual(['y/claude'])
  })

  it('finds every model of a provider by its name, written any way', () => {
    const glm = [model('glm-5.3', 'GLM 5.3'), model('glm-5.3-flash', 'GLM 5.3 Flash')]
    const plan = { id: 'zai-coding-plan', label: 'Z.ai Coding Plan' }
    for (const query of ['zai', 'Z.ai', 'z-ai', 'coding plan']) {
      expect(searchModels(glm, query, plan)).toHaveLength(2)
    }
    expect(searchModels(glm, 'zai')).toEqual([])
  })

  it('finds OpenRouter models whose id spells the vendor with a hyphen', () => {
    const router = [model('z-ai/glm-5', 'Z.ai: GLM 5'), model('openai/gpt-5', 'OpenAI: GPT-5')]
    const openRouter = { id: 'openrouter', label: 'OpenRouter' }
    expect(searchModels(router, 'zai', openRouter).map(({ id }) => id)).toEqual(['z-ai/glm-5'])
  })

  it('combines a provider word with a model word', () => {
    const glm = [model('glm-5.3', 'GLM 5.3'), model('glm-5.3-flash', 'GLM 5.3 Flash')]
    const plan = { id: 'zai-coding-plan', label: 'Z.ai Coding Plan' }
    expect(searchModels(glm, 'zai flash', plan).map(({ id }) => id)).toEqual(['glm-5.3-flash'])
  })
})

describe('looksLikeModelId', () => {
  it.each(['glm-5.3', 'x-ai/grok-5', 'gpt5', 'model:latest'])('treats %s as an id', (query) => {
    expect(looksLikeModelId(query)).toBe(true)
  })

  it.each(['zai', 'z.ai', 'z-ai', 'claude', 'fast model'])('treats %s as a search', (query) => {
    expect(looksLikeModelId(query)).toBe(false)
  })
})
