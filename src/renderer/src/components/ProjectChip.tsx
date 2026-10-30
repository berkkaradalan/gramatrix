import * as RadixMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Folder, FolderOpen, FolderPlus, MessageCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Project } from '@shared/types'
import { useApp } from '../state/app-context'
import { invoke } from '../state/hooks'
import { toast } from '../state/toasts'
import { errorMessage } from '../lib/format'

export async function addProjectFromDialog(
  reloadProjects: () => Promise<Project[]>
): Promise<Project | null> {
  try {
    const path = await invoke('app.pickDirectory', undefined)
    if (!path) return null
    const project = await invoke('projects.add', { path })
    await reloadProjects()
    return project
  } catch (error) {
    toast.error(errorMessage(error))
    return null
  }
}

/** Chooses where a new chat works. Defaults to no project. */
export function ProjectChip({
  projectId,
  onChange
}: {
  projectId: string | null
  onChange(projectId: string | null): void
}): ReactNode {
  const { projects, reloadProjects } = useApp()
  const project = projects.find(({ id }) => id === projectId)
  const Icon = project ? FolderOpen : MessageCircle

  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild>
        <button
          type="button"
          className="chip"
          aria-label={`Project: ${project?.name ?? 'No project'}`}
        >
          <Icon size={14} aria-hidden />
          <span className="chip-label">{project?.name ?? 'No project'}</span>
          <ChevronDown size={13} aria-hidden />
        </button>
      </RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content className="popover menu menu-wide" align="start" sideOffset={6}>
          <RadixMenu.Item className="menu-item" onSelect={() => onChange(null)}>
            <MessageCircle size={15} aria-hidden />
            <span className="menu-item-text">
              No project
              <span className="menu-item-hint">General chat, no file access</span>
            </span>
            {project === undefined && <Check className="menu-item-check" size={14} aria-hidden />}
          </RadixMenu.Item>
          {projects.length > 0 && <RadixMenu.Separator className="menu-separator" />}
          {projects.map((candidate) => (
            <RadixMenu.Item
              key={candidate.id}
              className="menu-item"
              onSelect={() => onChange(candidate.id)}
            >
              <Folder size={15} aria-hidden />
              <span className="menu-item-text">
                {candidate.name}
                <span className="menu-item-hint mono">{candidate.path}</span>
              </span>
              {candidate.id === project?.id && (
                <Check className="menu-item-check" size={14} aria-hidden />
              )}
            </RadixMenu.Item>
          ))}
          <RadixMenu.Separator className="menu-separator" />
          <RadixMenu.Item
            className="menu-item"
            onSelect={() =>
              void addProjectFromDialog(reloadProjects).then((added) => {
                if (added) onChange(added.id)
              })
            }
          >
            <FolderPlus size={15} aria-hidden />
            <span className="menu-item-text">Add a project</span>
          </RadixMenu.Item>
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  )
}
