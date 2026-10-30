import type { ProviderId, ProviderInfo } from '@shared/types'

/**
 * How requests reach a provider. The `-compatible` kinds use the same clients as the native ones,
 * pointed at the base URL of the entry.
 */
export type ProviderTransport =
  'anthropic' | 'openai' | 'openrouter' | 'openai-compatible' | 'anthropic-compatible'

export interface ProviderEntry extends ProviderInfo {
  transport: ProviderTransport
  baseUrl: string
  /** Key of this provider in models.dev. */
  modelsDevId: string
  /** When set, no other model is ever offered, whatever a model list says. */
  allowedModels?: readonly string[]
}

/** The only models the GLM plans accept. Anything else fails with error 1113. */
const GLM_CODING_PLAN_MODELS = ['glm-5.3', 'glm-5.3-flash']

/**
 * Every provider in the app. Model lists are not kept here, they come from the provider.
 * docs/providers.md records where each URL and default model was verified. Update both together.
 */
export const PROVIDERS: readonly ProviderEntry[] = [
  {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    kind: 'api',
    logo: 'anthropic',
    hint: 'An API key from the Claude Console. A Claude subscription cannot be used here.',
    keyUrl: 'https://platform.claude.com/settings/keys',
    transport: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    modelsDevId: 'anthropic',
    defaultModel: 'claude-sonnet-5-5'
  },
  {
    id: 'openai',
    label: 'ChatGPT (OpenAI)',
    kind: 'api',
    logo: 'openai',
    hint: 'An API key from the OpenAI Platform. A ChatGPT subscription cannot be used here.',
    keyUrl: 'https://platform.openai.com/api-keys',
    transport: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    modelsDevId: 'openai',
    defaultModel: 'gpt-6.1-sol'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'api',
    logo: 'openrouter',
    hint: 'One key for models from many providers, billed per token by OpenRouter.',
    keyUrl: 'https://openrouter.ai/settings/keys',
    transport: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelsDevId: 'openrouter',
    defaultModel: 'anthropic/claude-sonnet-5.5'
  },
  {
    id: 'zai',
    label: 'Z.ai API',
    kind: 'api',
    logo: 'zai',
    hint: 'A pay as you go key. For a GLM Coding Plan subscription, use Z.ai Coding Plan.',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    transport: 'openai-compatible',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    modelsDevId: 'zai',
    defaultModel: 'glm-5.3'
  },
  {
    id: 'minimax',
    label: 'MiniMax API',
    kind: 'api',
    logo: 'minimax',
    hint: 'A pay as you go key. Keys starting with sk-cp- belong to MiniMax Token Plan.',
    keyUrl: 'https://platform.minimax.io/console/keys',
    transport: 'anthropic-compatible',
    baseUrl: 'https://api.minimax.io/anthropic/v1',
    modelsDevId: 'minimax',
    defaultModel: 'MiniMax-M3'
  },
  {
    id: 'zai-coding-plan',
    label: 'Z.ai Coding Plan',
    kind: 'plan',
    logo: 'zai',
    hint: 'Create this key under API Keys, Personal Coding Plan tab. Standard keys use no quota.',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    transport: 'openai-compatible',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    modelsDevId: 'zai-coding-plan',
    defaultModel: 'glm-5.3',
    allowedModels: GLM_CODING_PLAN_MODELS
  },
  {
    id: 'zhipu-coding-plan',
    label: 'Zhipu Coding Plan (China)',
    kind: 'plan',
    logo: 'zai',
    hint: 'A Coding Plan key from bigmodel.cn. Keys from z.ai belong under Z.ai Coding Plan.',
    keyUrl: 'https://bigmodel.cn/apikey/coding-plan-per',
    transport: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    modelsDevId: 'zhipuai-coding-plan',
    defaultModel: 'glm-5.3',
    allowedModels: GLM_CODING_PLAN_MODELS
  },
  {
    id: 'minimax-coding-plan',
    label: 'MiniMax Token Plan',
    kind: 'plan',
    logo: 'minimax',
    hint: 'The key from your plan details page, starting with sk-cp-. Regular API keys do not work.',
    keyUrl: 'https://platform.minimax.io/console/plan',
    transport: 'anthropic-compatible',
    baseUrl: 'https://api.minimax.io/anthropic/v1',
    modelsDevId: 'minimax-coding-plan',
    defaultModel: 'MiniMax-M3'
  },
  {
    id: 'kimi-coding-plan',
    label: 'Kimi for Coding',
    kind: 'plan',
    logo: 'kimi',
    hint: 'A key from the Kimi Code console, for the international membership.',
    keyUrl: 'https://www.kimi.ai/code/console',
    transport: 'openai-compatible',
    baseUrl: 'https://api.kimi.ai/coding/v1',
    modelsDevId: 'kimi-code-plan-global',
    defaultModel: 'kimi-for-coding'
  },
  {
    id: 'alibaba-coding-plan',
    label: 'Alibaba Coding Plan',
    kind: 'plan',
    logo: 'alibaba',
    hint: 'Your plan key, starting with sk-sp-. A general key here is billed pay as you go.',
    keyUrl: 'https://modelstudio.console.alibabacloud.com/ap-southeast-1/subscription/coding-plan',
    transport: 'openai-compatible',
    baseUrl: 'https://coding-intl.dashscope.aliyuncs.com/v1',
    modelsDevId: 'alibaba-coding-plan',
    defaultModel: 'qwen3.7-plus'
  }
]

export function providerEntry(id: ProviderId): ProviderEntry {
  const entry = PROVIDERS.find((provider) => provider.id === id)
  if (!entry) throw new Error(`Unknown provider: ${id}`)
  return entry
}

/** Sibling entries look alike, so a failed test should say which one a key belongs to. */
const WRONG_ENTRY_HINTS: {
  provider: ProviderId
  matches(key: string): boolean
  hint: string
}[] = [
  {
    provider: 'minimax',
    matches: (key) => key.startsWith('sk-cp-'),
    hint: 'This looks like a plan key. Add it under MiniMax Token Plan instead.'
  },
  {
    provider: 'minimax-coding-plan',
    matches: (key) => !key.startsWith('sk-cp-'),
    hint: 'Plan keys start with sk-cp-. A pay as you go key belongs under MiniMax API.'
  },
  {
    // Z.ai keys of both kinds look the same, so only the failure itself is a clue.
    provider: 'zai',
    matches: () => true,
    hint: 'If this is a GLM Coding Plan key, add it under Z.ai Coding Plan instead.'
  },
  {
    provider: 'alibaba-coding-plan',
    matches: (key) => !key.startsWith('sk-sp-'),
    hint: 'Coding Plan keys start with sk-sp-. General Model Studio keys do not belong here.'
  }
]

export function wrongEntryHint(provider: ProviderId, key: string): string | null {
  const rule = WRONG_ENTRY_HINTS.find(
    (candidate) => candidate.provider === provider && candidate.matches(key)
  )
  return rule?.hint ?? null
}
