import { describe, expect, it } from 'vitest'
import type { MessagePart } from '@shared/types'
import { RunRecorder } from './run-recorder'

function recorder(): { recorder: RunRecorder; parts: () => MessagePart[] } {
  let saved: MessagePart[] = []
  const instance = new RunRecorder({
    emit: () => {},
    save: (parts) => {
      saved = structuredClone(parts)
    }
  })
  return {
    recorder: instance,
    parts: () => {
      instance.flush()
      return saved
    }
  }
}

const SIGNATURE = { google: { thoughtSignature: 'sig' } }

describe('RunRecorder provider data', () => {
  it('keeps each reasoning block as its own part with its own data', () => {
    const { recorder: run, parts } = recorder()
    run.blockStarted('reasoning')
    run.reasoningDelta('first ')
    run.reasoningDelta('thought')
    run.blockEnded('reasoning', { xai: { encrypted: 'a' } })
    run.blockStarted('reasoning')
    run.reasoningDelta('second')
    run.blockEnded('reasoning', { xai: { encrypted: 'b' } })

    expect(parts()).toEqual([
      { type: 'reasoning', text: 'first thought', providerMetadata: { xai: { encrypted: 'a' } } },
      { type: 'reasoning', text: 'second', providerMetadata: { xai: { encrypted: 'b' } } }
    ])
  })

  it('keeps encrypted reasoning that came without any text', () => {
    const { recorder: run, parts } = recorder()
    run.blockStarted('reasoning')
    run.blockEnded('reasoning', { xai: { encrypted: 'secret' } })
    expect(parts()).toEqual([
      { type: 'reasoning', text: '', providerMetadata: { xai: { encrypted: 'secret' } } }
    ])
  })

  it('adds nothing for an empty block without data', () => {
    const { recorder: run, parts } = recorder()
    run.blockStarted('reasoning')
    run.blockEnded('reasoning', undefined)
    run.blockStarted('text')
    run.blockEnded('text', {})
    expect(parts()).toEqual([])
  })

  it('attaches tool call data whether it arrives before or after the tool starts', () => {
    const { recorder: run, parts } = recorder()
    run.toolCallMetadata('early', SIGNATURE)
    run.toolStarted({ toolCallId: 'early', toolName: 'read_file', input: {} })
    run.toolStarted({ toolCallId: 'late', toolName: 'read_file', input: {} })
    run.toolCallMetadata('late', SIGNATURE)

    expect(parts()).toMatchObject([
      { toolCallId: 'early', providerMetadata: SIGNATURE },
      { toolCallId: 'late', providerMetadata: SIGNATURE }
    ])
  })

  it('still joins deltas into one part when a provider sends no start events', () => {
    const { recorder: run, parts } = recorder()
    run.textDelta('Hello ')
    run.textDelta('there')
    expect(parts()).toEqual([{ type: 'text', text: 'Hello there' }])
  })

  it('keeps the data of a text block', () => {
    const { recorder: run, parts } = recorder()
    run.blockStarted('text')
    run.textDelta('Done.')
    run.blockEnded('text', SIGNATURE)
    expect(parts()).toEqual([{ type: 'text', text: 'Done.', providerMetadata: SIGNATURE }])
  })
})
