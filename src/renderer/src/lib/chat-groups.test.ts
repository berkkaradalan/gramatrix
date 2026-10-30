import { describe, expect, it } from 'vitest'
import type { Chat, Project } from '@shared/types'
import { groupChats, searchChats } from './chat-groups'

function chat(id: string, projectId: string | null, title = id): Chat {
  return {
    id,
    projectId,
    title,
    model: { provider: 'openai', model: 'm' },
    permissionMode: 'ask',
    createdAt: 1,
    updatedAt: 1
  }
}

const project: Project = { id: 'p1', name: 'p', path: '/p', createdAt: 1, lastOpenedAt: 1 }

describe('groupChats', () => {
  it('splits project chats from general chats and keeps order', () => {
    const groups = groupChats([chat('a', 'p1'), chat('b', null), chat('c', 'p1')], [project])
    expect(groups.byProject.get('p1')?.map(({ id }) => id)).toEqual(['a', 'c'])
    expect(groups.general.map(({ id }) => id)).toEqual(['b'])
  })

  it('gives every project a list, even when empty', () => {
    expect(groupChats([], [project]).byProject.get('p1')).toEqual([])
  })

  it('keeps chats whose project is gone visible', () => {
    expect(groupChats([chat('a', 'gone')], [project]).general).toHaveLength(1)
  })
})

describe('searchChats', () => {
  it('ignores case', () => {
    const chats = [chat('a', null, 'Fix the Scheduler'), chat('b', null, 'Other')]
    expect(searchChats(chats, 'scheduler').map(({ id }) => id)).toEqual(['a'])
  })
})
