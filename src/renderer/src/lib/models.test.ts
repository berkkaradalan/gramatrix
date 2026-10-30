import { describe, expect, it } from 'vitest'
import type { ModelInfo, ModelRef } from '@shared/types'
import {
  formatContext,
  formatPrice,
  pushRecentModel,
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
})
