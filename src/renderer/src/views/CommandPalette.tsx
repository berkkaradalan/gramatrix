import * as RadixDialog from '@radix-ui/react-dialog'
import { Command } from 'cmdk'
import {
  CalendarClock,
  ChartNoAxesColumn,
  Folder,
  MessageSquare,
  MessagesSquare,
  Search,
  Settings,
  SquarePen
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { searchChats } from '../lib/chat-groups'
import { useApp } from '../state/app-context'
import { useNavigation } from '../state/navigation'

const RESULT_LIMIT = 50

export function CommandPalette({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange(open: boolean): void
}): ReactNode {
  const { chats, projects } = useApp()
  const { navigate, newChat } = useNavigation()
  const [query, setQuery] = useState('')

  const matchingChats = useMemo(
    () => searchChats(chats, query).slice(0, RESULT_LIMIT),
    [chats, query]
  )
  const needle = query.trim().toLowerCase()
  const matchingProjects = projects.filter(({ name }) => name.toLowerCase().includes(needle))
  const projectName = (id: string | null): string | undefined =>
    projects.find((project) => project.id === id)?.name

  const select = (action: () => void): void => {
    action()
    setQuery('')
    onOpenChange(false)
  }

  const commands = [
    { label: 'New chat', icon: SquarePen, action: () => newChat(null) },
    { label: 'Scheduled', icon: CalendarClock, action: () => navigate({ view: 'scheduled' }) },
    { label: 'Channels', icon: MessagesSquare, action: () => navigate({ view: 'channels' }) },
    { label: 'Usage', icon: ChartNoAxesColumn, action: () => navigate({ view: 'usage' }) },
    {
      label: 'Settings',
      icon: Settings,
      action: () => navigate({ view: 'settings', section: 'general' })
    }
  ].filter(({ label }) => label.toLowerCase().includes(needle))

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay" />
        <RadixDialog.Content className="palette" aria-describedby={undefined}>
          <RadixDialog.Title className="visually-hidden">Search</RadixDialog.Title>
          <Command shouldFilter={false} loop label="Search">
            <div className="palette-search">
              <Search size={16} aria-hidden />
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder="Search chats and projects"
                aria-label="Search chats and projects"
              />
            </div>
            <Command.List className="palette-list">
              <Command.Empty className="palette-empty">Nothing matches.</Command.Empty>
              {matchingChats.length > 0 && (
                <Command.Group heading="Chats">
                  {matchingChats.map((chat) => (
                    <Command.Item
                      key={chat.id}
                      className="palette-item"
                      value={`chat:${chat.id}`}
                      onSelect={() => select(() => navigate({ view: 'chat', chatId: chat.id }))}
                    >
                      <MessageSquare size={15} aria-hidden />
                      <span className="side-label">{chat.title}</span>
                      <span className="palette-meta">{projectName(chat.projectId)}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {matchingProjects.length > 0 && (
                <Command.Group heading="Projects">
                  {matchingProjects.map((project) => (
                    <Command.Item
                      key={project.id}
                      className="palette-item"
                      value={`project:${project.id}`}
                      onSelect={() => select(() => newChat(project.id))}
                    >
                      <Folder size={15} aria-hidden />
                      <span className="side-label">{project.name}</span>
                      <span className="palette-meta mono">{project.path}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {commands.length > 0 && (
                <Command.Group heading="Go to">
                  {commands.map(({ label, icon: Icon, action }) => (
                    <Command.Item
                      key={label}
                      className="palette-item"
                      value={`command:${label}`}
                      onSelect={() => select(action)}
                    >
                      <Icon size={15} aria-hidden />
                      <span className="side-label">{label}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
