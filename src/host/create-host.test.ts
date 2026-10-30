import { describe, expect, it } from 'vitest'
import { createTestHost } from './testing'

describe('createHost', () => {
  it('rejects unknown methods', async () => {
    const { host } = createTestHost()
    await expect(host.router.dispatch('nope.nothing', undefined)).rejects.toThrow('Unknown method')
  })

  it('merges settings over defaults and announces the change', () => {
    const { host, events } = createTestHost()
    const settings = host.services.settings.update({ theme: 'dracula' })
    expect(settings.theme).toBe('dracula')
    expect(settings.fontSize).toBe(14)
    expect(events.map((event) => event.event)).toContain('settings.changed')
  })

  it('keeps one project per path and refreshes its timestamp', () => {
    const { host, clock } = createTestHost()
    const first = host.services.projects.add('/work/demo')
    clock.advance(1000)
    const second = host.services.projects.add('/work/demo')
    expect(second.id).toBe(first.id)
    expect(second.name).toBe('demo')
    expect(second.lastOpenedAt).toBe(first.lastOpenedAt + 1000)
  })

  it('cascades project removal to chats', () => {
    const { host } = createTestHost()
    const project = host.services.projects.add('/work/demo')
    const chat = host.services.chats.create({
      projectId: project.id,
      model: { provider: 'openai', model: 'test' },
      permissionMode: 'ask'
    })
    host.services.projects.remove(project.id)
    expect(() => host.services.chats.get(chat.id)).toThrow('Chat not found')
  })

  it('lists chats from every project and general chats, newest first', () => {
    const { host, clock } = createTestHost()
    const { chats, projects } = host.services
    const model = { provider: 'openai' as const, model: 'test' }
    const first = chats.create({
      projectId: projects.add('/work/a').id,
      model,
      permissionMode: 'ask'
    })
    clock.advance(1000)
    const general = chats.create({ projectId: null, model, permissionMode: 'ask' })
    expect(chats.list().map(({ id }) => id)).toEqual([general.id, first.id])
    expect(general.projectId).toBeNull()
  })

  it('announces general chats with a null project', () => {
    const { host, events } = createTestHost()
    host.services.chats.create({
      projectId: null,
      model: { provider: 'openai', model: 'test' },
      permissionMode: 'ask'
    })
    expect(events.at(-1)).toEqual({ event: 'chats.changed', payload: { projectId: null } })
  })

  it('stores message parts and updates them in place', () => {
    const { host } = createTestHost()
    const project = host.services.projects.add('/work/demo')
    const chat = host.services.chats.create({
      projectId: project.id,
      model: { provider: 'openai', model: 'test' },
      permissionMode: 'ask'
    })
    const message = {
      id: 'm1',
      chatId: chat.id,
      role: 'assistant' as const,
      parts: [{ type: 'text' as const, text: 'one' }],
      createdAt: 1
    }
    host.services.chats.saveMessage(message)
    host.services.chats.saveMessage({ ...message, parts: [{ type: 'text', text: 'two' }] })
    expect(host.services.chats.messages(chat.id)).toEqual([
      { ...message, parts: [{ type: 'text', text: 'two' }] }
    ])
  })
})
