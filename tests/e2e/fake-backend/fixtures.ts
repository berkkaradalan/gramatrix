import type {
  Chat,
  ChatMessage,
  ModelInfo,
  ModelList,
  Project,
  ProviderId,
  ProviderStatus,
  UsageReport,
  UsageRow
} from '../../../src/shared/types'
import type { FakeSeed } from './fake-api'

export const PROJECT: Project = {
  id: 'p1',
  name: 'gramatrix',
  path: '/work/gramatrix',
  createdAt: 1,
  lastOpenedAt: 1
}

export const SECOND_PROJECT: Project = {
  id: 'p2',
  name: 'payments-service',
  path: '/work/payments-service',
  createdAt: 1,
  lastOpenedAt: 1
}

function provider(
  id: ProviderId,
  label: string,
  logo: string,
  kind: ProviderStatus['kind'],
  defaultModel: string,
  configured: boolean
): ProviderStatus {
  return {
    id,
    label,
    logo,
    kind,
    defaultModel,
    configured,
    hint:
      kind === 'plan'
        ? `Use the key from your ${label} subscription page.`
        : `Use a pay as you go key from ${label}.`,
    keyUrl: 'https://example.com/keys'
  }
}

export const PROVIDERS: ProviderStatus[] = [
  provider('anthropic', 'Claude (Anthropic)', 'anthropic', 'api', 'claude-sonnet', true),
  provider('openai', 'ChatGPT (OpenAI)', 'openai', 'api', 'gpt-sol', false),
  provider('openrouter', 'OpenRouter', 'openrouter', 'api', 'vendor-0/model-0', true),
  provider('zai', 'Z.ai', 'zai', 'api', 'glm', false),
  provider('minimax', 'MiniMax', 'minimax', 'api', 'minimax-m', false),
  provider('zai-coding-plan', 'Z.ai Coding Plan', 'zai', 'plan', 'glm', true),
  provider('minimax-coding-plan', 'MiniMax Coding Plan', 'minimax', 'plan', 'minimax-m', false),
  provider('kimi-coding-plan', 'Kimi Coding Plan', 'kimi', 'plan', 'kimi', false),
  provider('alibaba-coding-plan', 'Alibaba Coding Plan', 'alibaba', 'plan', 'qwen', false)
]

export const NO_PROVIDERS = PROVIDERS.map((item) => ({ ...item, configured: false }))

function model(id: string, name: string, patch: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id,
    name,
    contextWindow: 200_000,
    inputPrice: 3,
    outputPrice: 15,
    supportsTools: true,
    supportsReasoning: true,
    ...patch
  }
}

const VENDORS = ['acme', 'nova', 'zephyr', 'orion', 'lumen']

/** A list the size of OpenRouter, for checking that the picker stays fast. */
export function largeModelList(count = 500): ModelList {
  return {
    source: 'live',
    models: Array.from({ length: count }, (_, index) => {
      const vendor = VENDORS[index % VENDORS.length]
      return model(`${vendor}/model-${index}`, `${vendor} model ${index}`, {
        contextWindow: 32_000 * ((index % 8) + 1),
        inputPrice: (index % 20) / 4,
        outputPrice: (index % 20) / 2,
        supportsTools: index % 7 !== 0
      })
    })
  }
}

export const MODELS: FakeSeed['models'] = {
  anthropic: {
    source: 'live',
    models: [
      model('claude-opus', 'Claude Opus', {
        contextWindow: 1_000_000,
        inputPrice: 15,
        outputPrice: 75
      }),
      model('claude-sonnet', 'Claude Sonnet'),
      model('claude-haiku', 'Claude Haiku', { inputPrice: 0.8, outputPrice: 4 })
    ]
  },
  openrouter: largeModelList(),
  'zai-coding-plan': {
    source: 'catalog',
    models: [
      model('glm', 'GLM', { contextWindow: 128_000, inputPrice: null, outputPrice: null }),
      model('glm-air', 'GLM Air', {
        contextWindow: 64_000,
        inputPrice: null,
        outputPrice: null,
        supportsTools: false
      })
    ]
  }
}

export const CHAT: Chat = {
  id: 'c1',
  projectId: 'p1',
  title: 'Refactor the scheduler',
  model: { provider: 'anthropic', model: 'claude-sonnet' },
  permissionMode: 'ask',
  createdAt: Date.now() - 3_600_000,
  updatedAt: Date.now() - 3_600_000
}

export const GENERAL_CHAT: Chat = {
  ...CHAT,
  id: 'c2',
  projectId: null,
  title: 'Compare queue libraries',
  updatedAt: Date.now() - 2 * 86_400_000
}

export const MESSAGES: ChatMessage[] = [
  {
    id: 'm1',
    chatId: 'c1',
    role: 'user',
    parts: [{ type: 'text', text: 'Why does the job runner retry twice?' }],
    createdAt: 1
  },
  {
    id: 'm2',
    chatId: 'c1',
    role: 'assistant',
    parts: [
      { type: 'reasoning', text: 'Looking at the scheduler first.' },
      {
        type: 'tool-call',
        toolCallId: 't1',
        toolName: 'read_file',
        input: { path: 'src/host/scheduler/job-service.ts' },
        output: 'export class JobService {}',
        state: 'completed'
      },
      {
        type: 'tool-call',
        toolCallId: 't2',
        toolName: 'edit_file',
        input: {
          path: 'src/host/scheduler/job-service.ts',
          oldText: 'retries: 2',
          newText: 'retries: 1'
        },
        output: 'Edited',
        state: 'completed'
      },
      {
        type: 'text',
        text: 'The retry comes from `startJob`:\n\n```ts\nawait runner.runHeadless(input)\n```\n\n- The first call fails fast\n- The second call runs after catch up'
      }
    ],
    createdAt: 2
  }
]

function usageRow(key: string, label: string, scale: number, cost: number): UsageRow {
  return {
    key,
    label,
    runs: Math.max(Math.round(scale / 40_000), 1),
    inputTokens: scale,
    outputTokens: Math.round(scale / 4),
    cachedInputTokens: Math.round(scale / 3),
    reasoningTokens: Math.round(scale / 10),
    cost,
    unpricedRuns: 0
  }
}

function daysBack(count: number): UsageRow[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.now() - (count - 1 - index) * 86_400_000)
    const key = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-')
    const wave = Math.abs(Math.sin(index / 3)) * 180_000
    return usageRow(key, key, index % 7 === 5 ? 0 : Math.round(wave), wave / 200_000)
  })
}

export const USAGE_REPORT: UsageReport = {
  totals: {
    runs: 214,
    inputTokens: 4_120_000,
    outputTokens: 1_030_000,
    cachedInputTokens: 980_000,
    reasoningTokens: 210_000,
    cost: 18.42,
    unpricedRuns: 37
  },
  byDay: daysBack(30),
  byProvider: [
    usageRow('anthropic', 'Claude (Anthropic)', 2_900_000, 14.2),
    usageRow('openrouter', 'OpenRouter', 1_000_000, 4.22),
    usageRow('zai-coding-plan', 'Z.ai Coding Plan', 220_000, 0)
  ],
  byModel: [
    usageRow('claude-sonnet', 'Claude Sonnet', 2_400_000, 9.6),
    usageRow('claude-opus', 'Claude Opus', 500_000, 4.6),
    usageRow('acme/model-0', 'acme model 0', 1_000_000, 4.22),
    usageRow('glm', 'GLM', 220_000, 0)
  ],
  byProject: [
    usageRow('p1', 'gramatrix', 3_100_000, 13.1),
    usageRow('p2', 'payments-service', 800_000, 4.1),
    usageRow('general', 'General chats', 220_000, 1.22)
  ],
  bySource: [
    usageRow('chat', 'Chat', 3_300_000, 14.4),
    usageRow('job', 'Scheduled jobs', 600_000, 2.6),
    usageRow('subagent', 'Subagents', 180_000, 1.2),
    usageRow('channel', 'Channels', 40_000, 0.22)
  ]
}

export const SHELL_SEED: Partial<FakeSeed> = {
  settings: {
    onboardingCompleted: true,
    defaultModel: { provider: 'anthropic', model: 'claude-sonnet' },
    favoriteModels: [{ provider: 'anthropic', model: 'claude-opus' }],
    recentModels: [{ provider: 'openrouter', model: 'acme/model-0' }]
  },
  providers: PROVIDERS,
  projects: [PROJECT, SECOND_PROJECT],
  chats: [CHAT, GENERAL_CHAT],
  messages: MESSAGES,
  models: MODELS
}
