import type { Chat, Project } from '@shared/types'

export interface ChatGroups {
  byProject: Map<string, Chat[]>
  general: Chat[]
}

/** Splits chats for the sidebar. Input order is kept. Chats of unknown projects count as general. */
export function groupChats(chats: Chat[], projects: Project[]): ChatGroups {
  const byProject = new Map<string, Chat[]>(projects.map((project) => [project.id, []]))
  const general: Chat[] = []
  for (const chat of chats) {
    const bucket = chat.projectId === null ? undefined : byProject.get(chat.projectId)
    if (bucket) bucket.push(chat)
    else general.push(chat)
  }
  return { byProject, general }
}

export function searchChats(chats: Chat[], query: string): Chat[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return chats
  return chats.filter((chat) => chat.title.toLowerCase().includes(needle))
}
