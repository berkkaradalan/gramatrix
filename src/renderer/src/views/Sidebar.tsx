import {
  CalendarClock,
  ChartNoAxesColumn,
  ChevronRight,
  Ellipsis,
  Folder,
  FolderOpen,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Settings,
  SquarePen,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { Chat, Project } from '@shared/types'
import { LogoMark } from '../components/Logo'
import { addProjectFromDialog } from '../components/ProjectChip'
import { ProviderStrip } from '../components/ProviderStrip'
import { IconButton, Kbd, Menu, Skeleton, StatusDot, Tooltip } from '../components/ui'
import { groupChats } from '../lib/chat-groups'
import { formatAge } from '../lib/format'
import { useApp } from '../state/app-context'
import { invoke, useAction, usePersistedState } from '../state/hooks'
import { useNavigation } from '../state/navigation'
import { useOverlays } from '../state/overlays'
import { useIsRunning } from '../state/run-store'
import { useChatActions } from './chat-actions'

const modKey = navigator.platform.toLowerCase().includes('mac') ? 'Cmd' : 'Ctrl'

function NavItem({
  icon: Icon,
  label,
  active,
  collapsed,
  shortcut,
  onSelect
}: {
  icon: LucideIcon
  label: string
  active?: boolean
  collapsed: boolean
  shortcut?: string
  onSelect(): void
}): ReactNode {
  const button = (
    <button
      type="button"
      className="side-item"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={onSelect}
    >
      <Icon size={16} aria-hidden />
      {!collapsed && <span className="side-label">{label}</span>}
      {!collapsed && shortcut && <Kbd>{shortcut}</Kbd>}
    </button>
  )
  return collapsed ? (
    <Tooltip label={label} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  )
}

function ChatRow({ chat, indented }: { chat: Chat; indented?: boolean }): ReactNode {
  const { route, navigate } = useNavigation()
  const running = useIsRunning(chat.id)
  const { rename, remove, dialog } = useChatActions(chat)
  const [menuOpen, setMenuOpen] = useState(false)
  const active = route.view === 'chat' && route.chatId === chat.id

  return (
    <div className={menuOpen ? 'side-row side-row-held' : 'side-row'}>
      <button
        type="button"
        className={indented ? 'side-item side-chat side-indented' : 'side-item side-chat'}
        aria-current={active ? 'page' : undefined}
        onClick={() => navigate({ view: 'chat', chatId: chat.id })}
      >
        <span className="side-label">{chat.title}</span>
        {running ? (
          <StatusDot tone="busy" label="Running" />
        ) : (
          <span className="side-age">{formatAge(chat.updatedAt)}</span>
        )}
      </button>
      <span className="side-actions">
        <Menu
          onOpenChange={setMenuOpen}
          actions={[
            { label: 'Rename', icon: Pencil, onSelect: rename },
            { label: 'Delete', icon: Trash2, danger: true, onSelect: remove }
          ]}
        >
          <IconButton size="small" icon={Ellipsis} label={`Actions for ${chat.title}`} />
        </Menu>
      </span>
      {dialog}
    </div>
  )
}

function ProjectRow({
  project,
  chats,
  expanded,
  onToggle
}: {
  project: Project
  chats: Chat[]
  expanded: boolean
  onToggle(): void
}): ReactNode {
  const { reloadProjects, reloadChats } = useApp()
  const { route, navigate, newChat } = useNavigation()
  const { confirm } = useOverlays()
  const { run } = useAction()
  const [menuOpen, setMenuOpen] = useState(false)

  const remove = async (): Promise<void> => {
    const confirmed = await confirm({
      title: `Remove ${project.name}?`,
      body: 'Its chats and scheduled jobs are deleted from Gramatrix. The folder on your computer is not touched.',
      action: 'Remove project'
    })
    if (!confirmed) return
    await run(async () => {
      await invoke('projects.remove', { id: project.id })
      await Promise.all([reloadProjects(), reloadChats()])
      const showingIt =
        (route.view === 'home' && route.projectId === project.id) ||
        (route.view === 'chat' && chats.some((chat) => chat.id === route.chatId))
      if (showingIt) navigate({ view: 'home', projectId: null })
    })
  }

  return (
    <li>
      <div className={menuOpen ? 'side-row side-row-held' : 'side-row'}>
        <button type="button" className="side-item" aria-expanded={expanded} onClick={onToggle}>
          <ChevronRight
            className={expanded ? 'side-chevron side-chevron-open' : 'side-chevron'}
            size={14}
            aria-hidden
          />
          <Folder size={15} aria-hidden />
          <span className="side-label" title={project.path}>
            {project.name}
          </span>
        </button>
        <span className="side-actions">
          <IconButton
            size="small"
            icon={SquarePen}
            label={`New chat in ${project.name}`}
            onClick={() => newChat(project.id)}
          />
          <Menu
            onOpenChange={setMenuOpen}
            actions={[
              {
                label: 'Open project',
                icon: FolderOpen,
                onSelect: () => navigate({ view: 'project', projectId: project.id })
              },
              { label: 'Remove project', icon: Trash2, danger: true, onSelect: () => void remove() }
            ]}
          >
            <IconButton size="small" icon={Ellipsis} label={`Actions for ${project.name}`} />
          </Menu>
        </span>
      </div>
      {expanded && (
        <div className="side-children">
          {chats.length === 0 && <p className="side-note side-indented">No chats yet</p>}
          {chats.map((chat) => (
            <ChatRow key={chat.id} chat={chat} indented />
          ))}
        </div>
      )}
    </li>
  )
}

export function Sidebar({
  collapsed,
  onToggleCollapsed
}: {
  collapsed: boolean
  onToggleCollapsed(): void
}): ReactNode {
  const { projects, chats, chatsLoaded, chatsError, reloadProjects } = useApp()
  const { route, navigate, newChat, openPalette } = useNavigation()
  const [closed, setClosed] = usePersistedState<string[]>('sidebar.closedProjects', [])
  const groups = useMemo(() => groupChats(chats, projects), [chats, projects])

  const toggleProject = (id: string): void =>
    setClosed(closed.includes(id) ? closed.filter((item) => item !== id) : [...closed, id])

  return (
    <aside className={collapsed ? 'sidebar sidebar-collapsed' : 'sidebar'} aria-label="Sidebar">
      <div className="sidebar-top">
        {!collapsed && (
          <button
            type="button"
            className="brand"
            aria-label="Gramatrix home"
            onClick={() => navigate({ view: 'home', projectId: null })}
          >
            <LogoMark />
            <span className="brand-name">gramatrix</span>
          </button>
        )}
        <IconButton
          icon={collapsed ? PanelLeftOpen : PanelLeftClose}
          label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          side="right"
          onClick={onToggleCollapsed}
        />
      </div>

      <nav className="side-nav" aria-label="Main">
        <NavItem
          icon={SquarePen}
          label="New chat"
          collapsed={collapsed}
          active={route.view === 'home'}
          shortcut={`${modKey} N`}
          onSelect={() => newChat(null)}
        />
        <NavItem
          icon={Search}
          label="Search"
          collapsed={collapsed}
          shortcut={`${modKey} K`}
          onSelect={openPalette}
        />
        <NavItem
          icon={CalendarClock}
          label="Scheduled"
          collapsed={collapsed}
          active={route.view === 'scheduled'}
          onSelect={() => navigate({ view: 'scheduled' })}
        />
        <NavItem
          icon={MessagesSquare}
          label="Channels"
          collapsed={collapsed}
          active={route.view === 'channels'}
          onSelect={() => navigate({ view: 'channels' })}
        />
        <NavItem
          icon={ChartNoAxesColumn}
          label="Usage"
          collapsed={collapsed}
          active={route.view === 'usage'}
          onSelect={() => navigate({ view: 'usage' })}
        />
      </nav>

      {!collapsed && (
        <div className="side-scroll">
          <section aria-label="Projects">
            <header className="side-section">
              <h2>Projects</h2>
              <IconButton
                size="small"
                icon={Plus}
                label="Add project"
                onClick={() =>
                  void addProjectFromDialog(reloadProjects).then((project) => {
                    if (project) newChat(project.id)
                  })
                }
              />
            </header>
            {projects.length === 0 && <p className="side-note">No projects yet</p>}
            <ul className="list-plain">
              {projects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  chats={groups.byProject.get(project.id) ?? []}
                  expanded={!closed.includes(project.id)}
                  onToggle={() => toggleProject(project.id)}
                />
              ))}
            </ul>
          </section>

          <section aria-label="Chats">
            <header className="side-section">
              <h2>Chats</h2>
            </header>
            {!chatsLoaded && <Skeleton rows={3} />}
            {chatsError && <p className="side-note">Could not load chats.</p>}
            {chatsLoaded && !chatsError && groups.general.length === 0 && (
              <p className="side-note">No chats yet</p>
            )}
            {groups.general.map((chat) => (
              <ChatRow key={chat.id} chat={chat} />
            ))}
          </section>
        </div>
      )}

      <div className="sidebar-bottom">
        <ProviderStrip collapsed={collapsed} />
        <NavItem
          icon={Settings}
          label="Settings"
          collapsed={collapsed}
          active={route.view === 'settings'}
          onSelect={() => navigate({ view: 'settings', section: 'general' })}
        />
      </div>
    </aside>
  )
}
