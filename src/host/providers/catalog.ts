import type { ProviderId, ProviderInfo } from '@shared/types'

/**
 * How requests reach a provider. The `-compatible` kinds use the same clients as the native ones,
 * pointed at the base URL of the entry.
 */
export type ProviderTransport =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'openai-compatible'
  | 'anthropic-compatible'
  | 'google'
  | 'xai'
  | 'deepseek'
  | 'mistral'

export interface ProviderEntry extends ProviderInfo {
  transport: ProviderTransport
  baseUrl: string
  /** Key of this provider in models.dev. */
  modelsDevId: string
  /** When set, no other model is ever offered, whatever a model list says. */
  allowedModels?: readonly string[]
  /**
   * Sends stored reasoning and provider data back on later requests. Set it for providers that
   * fail or lose context without it. See `HistoryOptions` in src/host/agent/history.ts.
   */
  replaysReasoning?: boolean
  /** Model ids to leave out of a live list, for providers that list image or audio models too. */
  excludeModels?: RegExp
  /** Mistral only accepts tool call ids of nine letters and digits. */
  nineCharacterToolCallIds?: boolean
}

/**
 * Ids of models that cannot chat, for lists that mix them in. Matched as whole parts of an id, so
 * "qwen3-tts-flash" is caught but a name that merely contains "live" is not.
 */
const NON_CHAT_MODEL_IDS =
  /(^|[-_/.])(embedding|embed|audio|tts|asr|whisper|transcribe|realtime|live|image|imagine|imagen|video|veo|ocr|rerank|moderation|paraformer|cosyvoice|sambert|wanx)([-_/.\d]|$)/i

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
    id: 'gemini',
    label: 'Gemini (Google AI Studio)',
    kind: 'api',
    logo: 'google',
    hint: 'An API key from Google AI Studio. Google AI Pro or Ultra plans and Vertex AI keys do not work here.',
    keyUrl: 'https://aistudio.google.com/apikey',
    transport: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelsDevId: 'google',
    defaultModel: 'gemini-3.8-flash',
    // Gemini 3 checks the thought signatures of earlier tool calls.
    replaysReasoning: true,
    excludeModels: NON_CHAT_MODEL_IDS
  },
  {
    id: 'xai',
    label: 'Grok (xAI)',
    kind: 'api',
    logo: 'xai',
    hint: 'An API key from the xAI Console, with prepaid credits. A SuperGrok or X subscription does not work here.',
    keyUrl: 'https://console.x.ai/team/default/api-keys',
    transport: 'xai',
    baseUrl: 'https://api.x.ai/v1',
    modelsDevId: 'xai',
    defaultModel: 'grok-4.7',
    // Grok reasoning comes back encrypted, and later requests need it to keep their context.
    replaysReasoning: true,
    excludeModels: NON_CHAT_MODEL_IDS
  },
  {
    id: 'deepseek',
    label: 'DeepSeek API',
    kind: 'api',
    logo: 'deepseek',
    hint: 'A pay as you go key from the DeepSeek Platform. Add balance before your first request.',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    transport: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    modelsDevId: 'deepseek',
    defaultModel: 'deepseek-flash',
    // With tools, DeepSeek rejects a conversation whose earlier turns lost their reasoning.
    replaysReasoning: true
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    kind: 'api',
    logo: 'mistral',
    hint: 'An API key from Mistral AI Studio. The free plan works, with lower limits.',
    keyUrl: 'https://console.mistral.ai/api-keys',
    transport: 'mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    modelsDevId: 'mistral',
    defaultModel: 'mistral-large-latest',
    nineCharacterToolCallIds: true
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
    id: 'alibaba',
    label: 'Qwen (Alibaba Cloud)',
    kind: 'api',
    logo: 'alibaba',
    hint: 'A pay as you go key from Alibaba Cloud Model Studio, Singapore region. Keys from other regions and Coding Plan keys do not work here.',
    keyUrl: 'https://modelstudio.console.alibabacloud.com/ap-southeast-1/settings/api-key',
    transport: 'openai-compatible',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    modelsDevId: 'alibaba',
    defaultModel: 'qwen3.7-plus',
    // Thinking is on by default, and newer models need it back with tools.
    replaysReasoning: true,
    excludeModels: NON_CHAT_MODEL_IDS
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
    hint: 'Coding Plan keys start with sk-sp-. A pay as you go key belongs under Qwen (Alibaba Cloud).'
  },
  {
    provider: 'alibaba',
    matches: (key) => key.startsWith('sk-sp-'),
    hint: 'This looks like a Coding Plan key. Add it under Alibaba Coding Plan instead.'
  },
  {
    provider: 'alibaba',
    matches: (key) => !key.startsWith('sk-sp-'),
    hint: 'Keys only work in the region they were made in. This entry uses Singapore.'
  },
  {
    provider: 'gemini',
    matches: (key) => !key.startsWith('AQ.') && !key.startsWith('AIza'),
    hint: 'Keys from Google AI Studio start with AQ. or AIza. Google Cloud credentials do not work.'
  }
]

export function wrongEntryHint(provider: ProviderId, key: string): string | null {
  const rule = WRONG_ENTRY_HINTS.find(
    (candidate) => candidate.provider === provider && candidate.matches(key)
  )
  return rule?.hint ?? null
}
