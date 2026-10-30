import {
  Bot,
  FilePen,
  FilePlus,
  FileText,
  FolderTree,
  Search,
  SquareTerminal,
  Wrench,
  type LucideIcon
} from 'lucide-react'

interface ToolMeta {
  icon: LucideIcon
  label: string
}

const TOOLS: Record<string, ToolMeta> = {
  read_file: { icon: FileText, label: 'Read' },
  list_dir: { icon: FolderTree, label: 'List' },
  search_files: { icon: Search, label: 'Search' },
  write_file: { icon: FilePlus, label: 'Write' },
  edit_file: { icon: FilePen, label: 'Edit' },
  run_command: { icon: SquareTerminal, label: 'Run' },
  spawn_subagent: { icon: Bot, label: 'Subagent' }
}

export function toolMeta(toolName: string): ToolMeta {
  return TOOLS[toolName] ?? { icon: Wrench, label: toolName }
}

export interface EditInput {
  path: string
  oldText: string
  newText: string
}

export function isEditInput(input: unknown): input is EditInput {
  const record = input as Partial<EditInput> | null
  return typeof record?.oldText === 'string' && typeof record.newText === 'string'
}

export function inputString(input: unknown, key: string): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}
