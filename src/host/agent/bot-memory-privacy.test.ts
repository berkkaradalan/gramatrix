import { describe, expect, it } from 'vitest'
import { createAgentHarness } from './testing'

const MODEL = { provider: 'openai', model: 'test' } as const

/** A harness with a chat that talks to a bot named Ada, who remembers something personal. */
function botHarness({ general = false }: { general?: boolean } = {}) {
  const harness = createAgentHarness([{ text: 'Hi' }], 'read-only', { general })
  const { bots, chats } = harness.host.services
  const bot = bots.create({ name: 'Ada', soul: 'Warm and brief.', model: MODEL, learns: false })
  bots.addMemory(bot.id, 'user', 'Lives in Izmir.')
  const { projectId } = chats.get(harness.chatId)
  const chat = chats.create({ projectId, model: MODEL, permissionMode: 'read-only', botId: bot.id })
  return { harness, chatId: chat.id }
}

async function lastCall(harness: ReturnType<typeof createAgentHarness>) {
  const call = (await harness.lastModel()).doStreamCalls.at(-1)
  return {
    system: JSON.stringify(call?.prompt.filter(({ role }) => role === 'system')),
    tools: (call?.tools ?? []).map(({ name }) => name)
  }
}

describe('bot memory in runs nobody watches', () => {
  it('loads memory and the memory tool when the run allows it', async () => {
    const { harness, chatId } = botHarness()
    await harness.agent.runHeadless({ chatId, text: 'hi', source: 'job', withMemory: true })
    const { system, tools } = await lastCall(harness)
    expect(system).toContain('Lives in Izmir.')
    expect(tools).toContain('memory')
  })

  it('keeps memory and the memory tool out of a shared conversation but keeps the soul', async () => {
    const { harness, chatId } = botHarness()
    await harness.agent.runHeadless({ chatId, text: 'hi', source: 'channel', withMemory: false })
    const { system, tools } = await lastCall(harness)
    expect(system).toContain('You are Ada')
    expect(system).toContain('Warm and brief.')
    expect(system).toContain('memory is not available here')
    expect(system).not.toContain('Lives in Izmir.')
    expect(tools).not.toContain('memory')
    expect(tools).toContain('read_file')
  })

  it('leaves a shared general chat with no tools at all', async () => {
    const { harness, chatId } = botHarness({ general: true })
    await harness.agent.runHeadless({ chatId, text: 'hi', source: 'channel', withMemory: false })
    const { system, tools } = await lastCall(harness)
    expect(tools).toEqual([])
    expect(system).not.toContain('Your only tool is memory')
    expect(system).not.toContain('Lives in Izmir.')
  })

  it('treats a run that does not say as shared', async () => {
    const { harness, chatId } = botHarness()
    await harness.agent.runHeadless({ chatId, text: 'hi', source: 'channel' })
    const { system, tools } = await lastCall(harness)
    expect(system).not.toContain('Lives in Izmir.')
    expect(tools).not.toContain('memory')
  })
})

describe('bot memory in a chat continued in the app', () => {
  function linkToChannel(
    harness: ReturnType<typeof createAgentHarness>,
    chatId: string,
    isDirect: boolean
  ) {
    harness.context.db
      .prepare(
        'INSERT INTO channel_chats (kind, external_thread_id, chat_id, is_direct) VALUES (?, ?, ?, ?)'
      )
      .run('telegram', `thread-${chatId}`, chatId, isDirect ? 1 : 0)
  }

  it('keeps memory out of a group chat even when the user continues it in the app', async () => {
    const { harness, chatId } = botHarness()
    linkToChannel(harness, chatId, false)

    harness.agent.send(chatId, 'hi')
    await harness.waitForEvent('finished')

    const { system, tools } = await lastCall(harness)
    expect(system).not.toContain('Lives in Izmir.')
    expect(tools).not.toContain('memory')
  })

  it('uses memory in a direct chat continued in the app and in chats made in the app', async () => {
    const { harness, chatId } = botHarness()
    linkToChannel(harness, chatId, true)

    harness.agent.send(chatId, 'hi')
    await harness.waitForEvent('finished')

    const { system, tools } = await lastCall(harness)
    expect(system).toContain('Lives in Izmir.')
    expect(tools).toContain('memory')
  })
})
