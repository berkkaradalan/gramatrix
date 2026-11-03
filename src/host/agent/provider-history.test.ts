import { describe, expect, it } from 'vitest'
import type { ProviderId } from '@shared/types'
import { nineCharacterToolCallId } from './history'
import { createAgentHarness, type ScriptedStep } from './testing'

const READ = { name: 'list_dir', input: { path: '.' } }
const SIGNATURE = { google: { thoughtSignature: 'sig-1' } }

/** Runs two turns of a chat on `provider` and returns what the model got on the second one. */
async function secondPrompt(provider: ProviderId, firstTurn: ScriptedStep[]): Promise<unknown[]> {
  const harness = createAgentHarness([...firstTurn, { text: 'Second answer.' }])
  harness.host.services.chats.update(harness.chatId, { model: { provider, model: 'any' } })
  harness.agent.send(harness.chatId, 'first')
  await harness.waitForEvent('finished')
  harness.events.length = 0
  harness.agent.send(harness.chatId, 'second')
  await harness.waitForEvent('finished')
  const model = await harness.lastModel()
  return model.doStreamCalls.at(-1)?.prompt ?? []
}

function assistantParts(prompt: unknown[]): Record<string, unknown>[] {
  return (prompt as { role: string; content: unknown }[])
    .filter(({ role }) => role === 'assistant')
    .flatMap(({ content }) => content as Record<string, unknown>[])
}

describe('history for providers that need their reasoning back', () => {
  it('sends DeepSeek its earlier reasoning, which it requires with tools', async () => {
    const prompt = await secondPrompt('deepseek', [
      { reasoning: 'Look at the folder first.', toolCalls: [READ] },
      { text: 'First answer.' }
    ])
    expect(assistantParts(prompt)).toContainEqual(
      expect.objectContaining({ type: 'reasoning', text: 'Look at the folder first.' })
    )
  })

  it('sends Gemini the thought signature of each earlier tool call', async () => {
    const prompt = await secondPrompt('gemini', [
      { reasoning: 'Thinking.', toolCalls: [READ], providerMetadata: SIGNATURE },
      { text: 'First answer.' }
    ])
    expect(assistantParts(prompt)).toContainEqual(
      expect.objectContaining({ type: 'tool-call', providerOptions: SIGNATURE })
    )
  })

  it('keeps sending exactly the old history to providers that do not need it', async () => {
    const prompt = await secondPrompt('openai', [
      { reasoning: 'Private thoughts.', toolCalls: [READ], providerMetadata: SIGNATURE },
      { text: 'First answer.' }
    ])
    const parts = assistantParts(prompt)
    expect(parts.some(({ type }) => type === 'reasoning')).toBe(false)
    // The SDK adds the field to every part, so only a value would mean data was sent.
    expect(parts.some(({ providerOptions }) => providerOptions !== undefined)).toBe(false)
  })
})

describe('history for Mistral', () => {
  it('gives every tool call and its result the same nine character id', async () => {
    const prompt = await secondPrompt('mistral', [{ toolCalls: [READ] }, { text: 'First answer.' }])
    const messages = prompt as { role: string; content: { toolCallId?: string }[] }[]
    const callIds = messages
      .filter(({ role }) => role === 'assistant')
      .flatMap(({ content }) => content.flatMap(({ toolCallId }) => toolCallId ?? []))
    const resultIds = messages
      .filter(({ role }) => role === 'tool')
      .flatMap(({ content }) => content.flatMap(({ toolCallId }) => toolCallId ?? []))

    expect(callIds).toHaveLength(1)
    expect(callIds[0]).toMatch(/^[A-Za-z0-9]{9}$/)
    expect(resultIds).toEqual(callIds)
  })
})

describe('nineCharacterToolCallId', () => {
  it('keeps an id Mistral made', () => {
    expect(nineCharacterToolCallId('a1B2c3D4e')).toBe('a1B2c3D4e')
  })

  it('maps any other id to nine letters and digits, the same way every time', () => {
    const id = nineCharacterToolCallId('toolu_01ABCDEFGHIJKLMNOP')
    expect(id).toMatch(/^[A-Za-z0-9]{9}$/)
    expect(nineCharacterToolCallId('toolu_01ABCDEFGHIJKLMNOP')).toBe(id)
    expect(nineCharacterToolCallId('call_abc')).not.toBe(id)
  })
})
