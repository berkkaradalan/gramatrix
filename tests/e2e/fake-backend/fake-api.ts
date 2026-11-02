import type { HostEvents, RpcMethods } from '../../../src/shared/rpc'
import { DEFAULT_SETTINGS, type AppSettings } from '../../../src/shared/types'
import type {
  Bot,
  BotMemory,
  Chat,
  ChatMessage,
  ModelList,
  Project,
  ProviderId,
  ProviderStatus
} from '../../../src/shared/types'

/** Data the fake backend starts with. Anything left out starts empty. */
export interface FakeSeed {
  settings: Partial<AppSettings>
  providers: ProviderStatus[]
  projects: Project[]
  chats: Chat[]
  messages: ChatMessage[]
  models: Partial<Record<ProviderId, ModelList>>
  /** Makes `providers.models` wait, to show loading states. */
  modelDelayMs: number
  /** Makes `agent.send` fail, as it would with a broken model. */
  failSend: boolean
  /** Results for read only methods, used as they are. */
  overrides: Partial<{ [M in keyof RpcMethods]: RpcMethods[M]['result'] }>
  bots?: Bot[]
  memories?: BotMemory[]
  /** Makes `bots.create` and `bots.update` fail with this message, as the host does on bad input. */
  botError?: string
}

export interface FakeBackend {
  emit<E extends keyof HostEvents>(event: E, payload: HostEvents[E]): void
  calls: { method: string; params: unknown }[]
  chats: Chat[]
}

/** The page globals this harness touches. Tests compile without DOM types. */
export interface FakeGlobals {
  gramatrix: unknown
  fakeBackend: FakeBackend
}

/**
 * Stands in for window.gramatrix so renderer flows can be tested without real models.
 * This function is serialized into the page, so it can only use its argument.
 */
export function installFakeBackend({
  seed,
  defaults
}: {
  seed: FakeSeed
  defaults: AppSettings
}): void {
  const page = globalThis as unknown as FakeGlobals
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  const settings: AppSettings = { ...defaults, ...seed.settings }
  const calls: FakeBackend['calls'] = []
  const providers = seed.providers.map((provider) => ({ ...provider }))
  const projects = [...seed.projects]
  const chats = [...seed.chats]
  const bots = (seed.bots ?? []).map((bot) => ({ ...bot }))
  const memories = (seed.memories ?? []).map((memory) => ({ ...memory }))
  const secrets = new Set<string>()
  let nextId = 1

  const emit = (event: string, payload: unknown): void => {
    for (const listener of listeners.get(event) ?? []) listener(payload)
  }

  const results: Record<string, unknown> = {
    'app.info': {
      version: '0.0.0',
      platform: 'linux',
      secretBackend: 'keychain',
      transparency: 'supported'
    },
    'usage.report': {
      totals: {
        runs: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        cost: 0,
        unpricedRuns: 0
      },
      byDay: [],
      byProvider: [],
      byModel: [],
      byProject: [],
      bySource: []
    },
    'app.pickBackgroundVideo': null,
    'jobs.list': [],
    'jobs.runs': [],
    'channels.list': [],
    'channels.pairings': [],
    'agent.pendingApprovals': [],
    ...seed.overrides
  }

  const providerOf = (name: string): ProviderStatus | undefined =>
    providers.find((provider) => `provider:${provider.id}` === name)

  const handlers: Record<string, (params: never) => unknown> = {
    'settings.get': () => settings,
    'settings.update': (patch: Partial<AppSettings>) => Object.assign(settings, patch),
    'providers.list': () => providers.map((provider) => ({ ...provider })),
    'providers.models': async ({ provider }: { provider: ProviderId }) => {
      if (seed.modelDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, seed.modelDelayMs))
      }
      return seed.models[provider] ?? { models: [], source: 'catalog' }
    },
    'opencode.hasKey': ({ provider }: { provider: ProviderId }) => provider === 'zai-coding-plan',
    'opencode.importKey': () => ({ ok: true }),
    'providers.test': ({ provider, key }: { provider: ProviderId; key?: string }) =>
      key?.startsWith('bad') || secrets.has(`bad:${provider}`)
        ? {
            ok: false,
            error: 'The key was rejected. Create a new key and try again.',
            details: {
              endpoint: 'https://api.example.com/v1',
              model: 'test-model',
              status: 401,
              code: 'invalid_api_key',
              message: 'Invalid API key'
            }
          }
        : { ok: true },
    'secrets.set': ({ name, value }: { name: string; value: string }) => {
      const provider = providerOf(name)
      if (!provider) return
      provider.configured = true
      if (value.startsWith('bad')) secrets.add(`bad:${provider.id}`)
      else secrets.delete(`bad:${provider.id}`)
    },
    'secrets.delete': ({ name }: { name: string }) => {
      const provider = providerOf(name)
      if (provider) provider.configured = false
    },
    'projects.list': () => [...projects],
    'projects.add': ({ path }: { path: string }) => {
      const project: Project = {
        id: `project-${nextId++}`,
        name: path.split('/').at(-1) ?? path,
        path,
        createdAt: 1,
        lastOpenedAt: 1
      }
      projects.unshift(project)
      return project
    },
    'projects.remove': ({ id }: { id: string }) => {
      projects.splice(
        projects.findIndex((project) => project.id === id),
        1
      )
      for (let index = chats.length - 1; index >= 0; index--) {
        if (chats[index]?.projectId === id) chats.splice(index, 1)
      }
    },
    'chats.list': () => [...chats],
    'chats.create': ({
      projectId,
      model,
      permissionMode,
      botId
    }: Pick<Chat, 'projectId' | 'model'> & {
      permissionMode?: Chat['permissionMode']
      botId?: string | null
    }) => {
      const chat: Chat = {
        id: `chat-${nextId++}`,
        projectId,
        botId: botId ?? null,
        title: 'New chat',
        model,
        permissionMode: permissionMode ?? 'ask',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      chats.unshift(chat)
      emit('chats.changed', { projectId })
      return chat
    },
    'chats.update': ({ id, ...patch }: Partial<Chat> & { id: string }) => {
      const chat = chats.find((candidate) => candidate.id === id)
      if (chat) Object.assign(chat, patch)
      emit('chats.changed', { projectId: chat?.projectId ?? null })
      return chat
    },
    'chats.remove': ({ id }: { id: string }) => {
      chats.splice(
        chats.findIndex((chat) => chat.id === id),
        1
      )
      emit('chats.changed', { projectId: null })
    },
    'chats.messages': ({ chatId }: { chatId: string }) =>
      seed.messages.filter((message) => message.chatId === chatId),
    'bots.list': () => [...bots].sort((a, b) => a.name.localeCompare(b.name)),
    'bots.create': (input: Pick<Bot, 'name' | 'soul' | 'model' | 'learns'>) => {
      if (seed.botError) throw new Error(seed.botError)
      const bot: Bot = { ...input, id: `bot-${nextId++}`, createdAt: 1, updatedAt: 1 }
      bots.push(bot)
      emit('bots.changed', { botId: bot.id })
      return bot
    },
    'bots.update': ({ id, patch }: { id: string; patch: Partial<Bot> }) => {
      if (seed.botError) throw new Error(seed.botError)
      const bot = bots.find((candidate) => candidate.id === id)
      if (bot) Object.assign(bot, patch)
      emit('bots.changed', { botId: id })
      return bot
    },
    'bots.remove': ({ id }: { id: string }) => {
      bots.splice(
        bots.findIndex((bot) => bot.id === id),
        1
      )
      for (const chat of chats) if (chat.botId === id) chat.botId = null
      emit('bots.changed', { botId: id })
    },
    'bots.memories': ({ botId }: { botId: string }) =>
      memories.filter((memory) => memory.botId === botId),
    'bots.addMemory': ({ botId, kind, content }: Pick<BotMemory, 'botId' | 'kind' | 'content'>) => {
      const memory: BotMemory = {
        id: `memory-${nextId++}`,
        botId,
        kind,
        content: content.trim(),
        createdAt: 1,
        updatedAt: 1
      }
      memories.push(memory)
      emit('bots.changed', { botId })
      return memory
    },
    'bots.updateMemory': ({ id, content }: { id: string; content: string }) => {
      const memory = memories.find((candidate) => candidate.id === id)
      if (memory) memory.content = content.trim()
      emit('bots.changed', { botId: memory?.botId ?? '' })
      return memory
    },
    'bots.removeMemory': ({ id }: { id: string }) => {
      const index = memories.findIndex((memory) => memory.id === id)
      const [removed] = memories.splice(index, 1)
      emit('bots.changed', { botId: removed?.botId ?? '' })
    },
    'agent.send': () => {
      if (seed.failSend) throw new Error('The agent could not start.')
      return { runId: 'run-1' }
    },
    'agent.retry': () => ({ runId: 'run-2' })
  }

  page.gramatrix = {
    invoke: async (method: string, params: unknown) => {
      calls.push({ method, params })
      const handler = handlers[method]
      return handler ? handler(params as never) : results[method]
    },
    on: (event: string, listener: (payload: never) => void) => {
      const set = listeners.get(event) ?? new Set()
      listeners.set(event, set)
      set.add(listener as (payload: unknown) => void)
      return () => set.delete(listener as (payload: unknown) => void)
    }
  }
  page.fakeBackend = { emit: emit as FakeBackend['emit'], calls, chats }
}

export const FAKE_DEFAULTS = DEFAULT_SETTINGS
