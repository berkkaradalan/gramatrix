import { describe, expect, it, vi } from 'vitest'
import { ApprovalBroker, decidePermission, lowerPermissionMode } from './permissions'

const INPUT = { chatId: 'c', toolCallId: 't', toolName: 'write_file', summary: 's', input: {} }

describe('decidePermission', () => {
  it.each([
    ['read-only', 'allow', 'deny', 'deny'],
    ['ask', 'allow', 'ask', 'ask'],
    ['accept-edits', 'allow', 'allow', 'ask'],
    ['full-access', 'allow', 'allow', 'allow']
  ] as const)('%s', (mode, read, write, execute) => {
    expect(decidePermission(mode, 'read')).toBe(read)
    expect(decidePermission(mode, 'write')).toBe(write)
    expect(decidePermission(mode, 'execute')).toBe(execute)
  })
})

describe('lowerPermissionMode', () => {
  it('picks the stricter mode in either order', () => {
    expect(lowerPermissionMode('read-only', 'full-access')).toBe('read-only')
    expect(lowerPermissionMode('full-access', 'ask')).toBe('ask')
    expect(lowerPermissionMode('accept-edits', 'accept-edits')).toBe('accept-edits')
  })
})

describe('ApprovalBroker', () => {
  it('resolves with the answer and clears the request', async () => {
    const broker = new ApprovalBroker()
    const settled = vi.fn()
    const answer = broker.request(
      INPUT,
      new AbortController().signal,
      ({ id }) => broker.resolve(id, true),
      settled
    )
    await expect(answer).resolves.toBe(true)
    expect(settled).toHaveBeenCalledOnce()
    expect(broker.forChat('c')).toEqual([])
  })

  it('lists pending requests per chat', () => {
    const broker = new ApprovalBroker()
    void broker.request(INPUT, new AbortController().signal, vi.fn(), vi.fn())
    expect(broker.forChat('c')).toHaveLength(1)
    expect(broker.forChat('other')).toEqual([])
  })

  it('denies when the run is cancelled', async () => {
    const broker = new ApprovalBroker()
    const controller = new AbortController()
    const answer = broker.request(INPUT, controller.signal, vi.fn(), vi.fn())
    controller.abort()
    await expect(answer).resolves.toBe(false)
    expect(broker.forChat('c')).toEqual([])
  })

  it('rejects answers to requests that are gone', () => {
    expect(() => new ApprovalBroker().resolve('nope', true)).toThrow('no longer active')
  })
})
