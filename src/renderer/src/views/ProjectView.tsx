import { FolderOpen, MessageSquare, SquarePen } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import type { Project } from '@shared/types'
import { UsageReportView } from '../components/usage/UsageReportView'
import { Button, EmptyState, PageHeader } from '../components/ui'
import { formatAge } from '../lib/format'
import { useApp } from '../state/app-context'
import { useNavigation } from '../state/navigation'

export function ProjectView({ project }: { project: Project }): ReactNode {
  const { chats } = useApp()
  const { navigate, newChat } = useNavigation()
  const projectChats = chats.filter(({ projectId }) => projectId === project.id)
  const query = useMemo(() => ({ projectId: project.id }), [project.id])

  return (
    <div className="page">
      <div className="page-column">
        <PageHeader
          title={project.name}
          description={<span className="mono">{project.path}</span>}
          action={
            <Button variant="primary" icon={SquarePen} onClick={() => newChat(project.id)}>
              New chat
            </Button>
          }
        />
        <UsageReportView query={query} showProjects={false} />
        <section className="stack-small" aria-label="Chats in this project">
          <h2>Chats</h2>
          {projectChats.length === 0 ? (
            <EmptyState icon={FolderOpen} title="No chats yet">
              Start a chat to put the agent to work in this folder.
            </EmptyState>
          ) : (
            <ul className="list list-plain">
              {projectChats.map((chat) => (
                <li key={chat.id}>
                  <button
                    type="button"
                    className="list-link"
                    onClick={() => navigate({ view: 'chat', chatId: chat.id })}
                  >
                    <MessageSquare size={15} aria-hidden />
                    <span className="side-label">{chat.title}</span>
                    <span className="side-age">{formatAge(chat.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
