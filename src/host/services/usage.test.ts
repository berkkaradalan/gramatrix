import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LanguageModelUsage } from 'ai'
import type { Chat, ModelInfo, Project, UsageReport } from '@shared/types'
import { createAgentHarness } from '../agent/testing'
import { createTestHost, type TestHost } from '../testing'
import { UsageService, estimateCost, type StepUsage } from './usage'

const TOKENS: LanguageModelUsage = {
  inputTokens: 1000,
  inputTokenDetails: { noCacheTokens: 800, cacheReadTokens: 200, cacheWriteTokens: undefined },
  outputTokens: 500,
  outputTokenDetails: { textTokens: 400, reasoningTokens: 100 },
  totalTokens: 1500
}

const STEP: StepUsage = { usage: TOKENS, providerMetadata: undefined }

const PRICED: ModelInfo = {
  id: 'gpt',
  name: 'GPT Test',
  contextWindow: null,
  inputPrice: 10,
  outputPrice: 20,
  cachedInputPrice: 1,
  supportsTools: true,
  supportsReasoning: false
}

interface Fixture extends TestHost {
  usage: UsageService
  project: Project
  chat: Chat
  general: Chat
}

function fixture(model: ModelInfo | null = PRICED): Fixture {
  const testHost = createTestHost()
  const { chats, projects } = testHost.host.services
  const project = projects.add('/work/demo')
  const ref = { provider: 'openai' as const, model: 'gpt' }
  return {
    ...testHost,
    usage: new UsageService(testHost.context, { findModel: async () => model ?? undefined }),
    project,
    chat: chats.create({ projectId: project.id, model: ref, permissionMode: 'ask' }),
    general: chats.create({ projectId: null, model: ref, permissionMode: 'ask' })
  }
}

function report(
  usage: UsageService,
  query: Parameters<UsageService['report']>[0] = {}
): UsageReport {
  return usage.report(query)
}

describe('estimateCost', () => {
  it('charges cached tokens at the cached price', () => {
    // 800 at 10, 200 at 1 and 500 at 20, per million.
    expect(estimateCost(TOKENS, PRICED)).toBeCloseTo(0.0182, 8)
  })

  it('charges cached tokens at the input price when no cached price is known', () => {
    expect(estimateCost(TOKENS, { ...PRICED, cachedInputPrice: null })).toBeCloseTo(0.02, 8)
  })

  it('is null when a price is unknown, never zero', () => {
    expect(estimateCost(TOKENS, undefined)).toBeNull()
    expect(estimateCost(TOKENS, { ...PRICED, inputPrice: null })).toBeNull()
    expect(estimateCost(TOKENS, { ...PRICED, outputPrice: null })).toBeNull()
  })

  it('is null when the provider reported no tokens', () => {
    const empty = { ...TOKENS, inputTokens: undefined, outputTokens: undefined }
    expect(estimateCost(empty, PRICED)).toBeNull()
  })

  it('keeps a real price of zero', () => {
    expect(
      estimateCost(TOKENS, { ...PRICED, inputPrice: 0, outputPrice: 0, cachedInputPrice: 0 })
    ).toBe(0)
  })
})

describe('UsageService.record', () => {
  it('stores a step and announces it', async () => {
    const { usage, chat, project, events } = fixture()
    await usage.record({ chat, project, source: 'chat', step: STEP })

    expect(report(usage).totals).toEqual({
      runs: 1,
      inputTokens: 1000,
      outputTokens: 500,
      cachedInputTokens: 200,
      reasoningTokens: 100,
      cost: expect.closeTo(0.0182, 8),
      unpricedRuns: 0
    })
    expect(events.at(-1)).toEqual({
      event: 'usage.changed',
      payload: { chatId: chat.id, projectId: project.id }
    })
  })

  it('prefers a reported cost over the list price', async () => {
    const { usage, chat, project } = fixture()
    const step = {
      usage: TOKENS,
      providerMetadata: { openrouter: { usage: { cost: 0.5 } } }
    } as StepUsage
    await usage.record({ chat, project, source: 'chat', step })
    expect(report(usage).totals.cost).toBe(0.5)
  })

  it('counts a step without a known price as unpriced', async () => {
    const { usage, chat, project } = fixture(null)
    await usage.record({ chat, project, source: 'chat', step: STEP })
    expect(report(usage).totals).toMatchObject({ cost: 0, unpricedRuns: 1, inputTokens: 1000 })
  })

  it('still records when the price lookup fails', async () => {
    const { context, chat, project } = fixture()
    const usage = new UsageService(context, {
      findModel: async () => {
        throw new Error('offline')
      }
    })
    await usage.record({ chat, project, source: 'chat', step: STEP })
    expect(report(usage).totals.unpricedRuns).toBe(1)
  })

  it('survives a chat removed before the step is written', async () => {
    const { usage, chat, project, host } = fixture()
    host.services.chats.remove(chat.id)
    await usage.record({ chat, project, source: 'chat', step: STEP })
    expect(report(usage).totals.runs).toBe(1)
  })

  it('keeps a recorded row after its chat is deleted', async () => {
    const { usage, chat, project, host } = fixture()
    await usage.record({ chat, project, source: 'chat', step: STEP })
    host.services.chats.remove(chat.id)
    expect(report(usage).totals.runs).toBe(1)
    expect(report(usage, { chatId: chat.id }).totals.runs).toBe(0)
  })

  it('keeps the project label after the project is deleted', async () => {
    const { usage, chat, project, host } = fixture()
    await usage.record({ chat, project, source: 'chat', step: STEP })
    host.services.projects.remove(project.id)
    expect(report(usage).byProject).toMatchObject([{ key: 'deleted:demo', label: 'demo', runs: 1 }])
    expect(report(usage).byModel[0]?.label).toBe('GPT Test')
  })

  it('does not turn a deleted project into general chats', async () => {
    const { usage, chat, project, general, host } = fixture()
    await usage.record({ chat, project, source: 'chat', step: STEP })
    await usage.record({ chat: general, project: null, source: 'chat', step: STEP })
    host.services.projects.remove(project.id)
    expect(report(usage, { projectId: null }).totals.runs).toBe(1)
  })
})

describe('UsageService.report', () => {
  it('filters by time, chat and project', async () => {
    const { usage, chat, project, general, clock } = fixture()
    await usage.record({ chat, project, source: 'chat', step: STEP })
    clock.advance(1000)
    await usage.record({ chat: general, project: null, source: 'chat', step: STEP })
    const later = 1_000_000 + 1000

    expect(report(usage, { from: later }).totals.runs).toBe(1)
    expect(report(usage, { to: later }).totals.runs).toBe(1)
    expect(report(usage, { chatId: chat.id }).totals.runs).toBe(1)
    expect(report(usage, { projectId: project.id }).totals.runs).toBe(1)
    expect(report(usage, { projectId: null }).totals.runs).toBe(1)
    expect(report(usage).totals.runs).toBe(2)
  })

  it('breaks down by provider, model, project and source, costliest first', async () => {
    const { usage, chat, project, general, host } = fixture()
    const zaiChat = host.services.chats.update(general.id, {
      model: { provider: 'zai', model: 'glm' }
    })
    await usage.record({ chat, project, source: 'chat', step: STEP })
    await usage.record({ chat, project, source: 'subagent', step: STEP })
    await usage.record({ chat: zaiChat, project: null, source: 'job', step: STEP })

    const result = report(usage)
    expect(result.byProvider.map(({ key, label, runs }) => [key, label, runs])).toEqual([
      ['openai', 'ChatGPT (OpenAI)', 2],
      ['zai', 'Z.ai API', 1]
    ])
    expect(result.byModel.map(({ key }) => key)).toEqual(['openai:gpt', 'zai:glm'])
    expect(result.byProject.map(({ key, label }) => [key, label])).toEqual([
      [project.id, 'demo'],
      ['general', 'General chats']
    ])
    expect(result.bySource.map(({ key, label }) => [key, label]).sort()).toEqual([
      ['chat', 'Chats'],
      ['job', 'Scheduled jobs'],
      ['subagent', 'Subagents']
    ])
  })

  it('is empty, not broken, with no data', () => {
    const { usage } = fixture()
    expect(report(usage)).toMatchObject({
      totals: { runs: 0, cost: 0, unpricedRuns: 0 },
      byDay: [],
      byProvider: []
    })
  })

  describe('byDay', () => {
    const originalZone = process.env['TZ']

    afterEach(() => {
      process.env['TZ'] = originalZone
    })

    function recordAt(test: Fixture, time: number): Promise<void> {
      vi.spyOn(test.context, 'now').mockReturnValue(time)
      return test.usage.record({
        chat: test.chat,
        project: test.project,
        source: 'chat',
        step: STEP
      })
    }

    it('groups by local day, not UTC day', async () => {
      process.env['TZ'] = 'Asia/Tokyo'
      const test = fixture()
      // 16:00 UTC on the 1st is 01:00 on the 2nd in Tokyo.
      await recordAt(test, Date.UTC(2026, 9, 1, 16))
      await recordAt(test, Date.UTC(2026, 9, 1, 14))
      expect(report(test.usage).byDay.map(({ key, runs }) => [key, runs])).toEqual([
        ['2026-10-01', 1],
        ['2026-10-02', 1]
      ])
    })

    it('fills empty days when the range is known', async () => {
      process.env['TZ'] = 'Europe/Berlin'
      const test = fixture()
      await recordAt(test, new Date(2026, 9, 26, 12).getTime())
      const days = report(test.usage, {
        from: new Date(2026, 9, 24).getTime(),
        to: new Date(2026, 9, 27).getTime()
      }).byDay
      // The 25th is 25 hours long in Berlin, and still has to appear exactly once.
      expect(days.map(({ key, runs }) => [key, runs])).toEqual([
        ['2026-10-24', 0],
        ['2026-10-25', 0],
        ['2026-10-26', 1]
      ])
    })

    it('lists only used days without a full range', async () => {
      const test = fixture()
      await recordAt(test, new Date(2026, 0, 5, 12).getTime())
      expect(report(test.usage).byDay.map(({ key }) => key)).toEqual(['2026-01-05'])
    })
  })
})

describe('recording from agent runs', () => {
  const COMMAND = { name: 'run_command', input: { command: 'sleep 5' } }
  const SPAWN = {
    name: 'spawn_subagent',
    input: { name: 'helper', instructions: 'Help.', task: 'Do it.' }
  }

  it('records one row per model step', async () => {
    const harness = createAgentHarness([
      { toolCalls: [{ name: 'list_dir', input: {} }] },
      { text: 'done' }
    ])
    harness.agent.send(harness.chatId, 'go')
    await harness.waitForEvent('finished')
    expect(harness.usage.report({}).totals).toMatchObject({
      runs: 2,
      inputTokens: 200,
      outputTokens: 100,
      cachedInputTokens: 40,
      reasoningTokens: 20,
      unpricedRuns: 2
    })
    expect(harness.usage.report({}).bySource.map(({ key }) => key)).toEqual(['chat'])
  })

  it('counts subagent steps under subagent', async () => {
    const harness = createAgentHarness([
      { toolCalls: [SPAWN] },
      { text: 'summary' },
      { text: 'done' }
    ])
    harness.agent.send(harness.chatId, 'go')
    await harness.waitForEvent('finished')
    const sources = harness.usage.report({}).bySource.map(({ key, runs }) => [key, runs])
    expect(sources.sort()).toEqual([
      ['chat', 2],
      ['subagent', 1]
    ])
  })

  it.each(['job', 'channel'] as const)('counts %s runs under their source', async (source) => {
    const harness = createAgentHarness([{ text: 'done' }])
    await harness.agent.runHeadless({ chatId: harness.chatId, text: 'go', source })
    expect(harness.usage.report({}).bySource.map(({ key }) => key)).toEqual([source])
  })

  it('counts general chats', async () => {
    const harness = createAgentHarness([{ text: 'hi' }], 'ask', { general: true })
    harness.agent.send(harness.chatId, 'hello')
    await harness.waitForEvent('finished')
    expect(harness.usage.report({ projectId: null }).totals.runs).toBe(1)
  })

  it('keeps what a cancelled run used', async () => {
    const harness = createAgentHarness([{ text: 'first', toolCalls: [COMMAND] }])
    harness.agent.send(harness.chatId, 'go')
    await harness.wait(() => harness.usage.report({}).totals.runs === 1)
    harness.agent.cancel(harness.chatId)
    await harness.waitForEvent('cancelled')
    expect(harness.usage.report({}).totals.runs).toBe(1)
  })

  it('keeps what a failed run used', async () => {
    const harness = createAgentHarness([
      { toolCalls: [{ name: 'list_dir', input: {} }] },
      { error: 'model broke' }
    ])
    harness.agent.send(harness.chatId, 'go')
    await harness.waitForEvent('failed')
    expect(harness.usage.report({}).totals.runs).toBe(1)
  })

  it('writes usage before the final event, so a report right after it is complete', async () => {
    const harness = createAgentHarness([{ text: 'done' }])
    const seen: number[] = []
    const { emit } = harness.context
    harness.context.emit = (event, payload) => {
      if (event === 'run.event' && (payload as { type: string }).type === 'finished') {
        seen.push(harness.usage.report({}).totals.runs)
      }
      emit(event, payload)
    }
    harness.agent.send(harness.chatId, 'go')
    await harness.waitForEvent('finished')
    expect(seen).toEqual([1])
  })
})

describe('createHost wiring', () => {
  it('serves usage.report', async () => {
    const { host }: TestHost = createTestHost()
    await expect(host.router.dispatch('usage.report', {})).resolves.toMatchObject({
      totals: { runs: 0 }
    })
  })
})
