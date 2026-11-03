import {
  BookOpen,
  Bot,
  Brain,
  Bug,
  Cpu,
  FolderOpen,
  Ghost,
  Globe,
  Rocket,
  Shield,
  Sparkles,
  Terminal,
  type LucideIcon
} from 'lucide-react'
import { BOT_ICONS, type BotIcon } from '@shared/types'

/** How each picture that comes with the app is drawn, and what it is called for screen readers. */
export const BOT_ICON_DETAILS: Record<BotIcon, { icon: LucideIcon; label: string }> = {
  bot: { icon: Bot, label: 'Robot' },
  terminal: { icon: Terminal, label: 'Terminal' },
  cpu: { icon: Cpu, label: 'Chip' },
  brain: { icon: Brain, label: 'Brain' },
  shield: { icon: Shield, label: 'Shield' },
  folder: { icon: FolderOpen, label: 'Folder' },
  rocket: { icon: Rocket, label: 'Rocket' },
  ghost: { icon: Ghost, label: 'Ghost' },
  sparkles: { icon: Sparkles, label: 'Sparkles' },
  book: { icon: BookOpen, label: 'Book' },
  bug: { icon: Bug, label: 'Bug' },
  globe: { icon: Globe, label: 'Globe' }
}

export function isBotIcon(value: string | null): value is BotIcon {
  return value !== null && (BOT_ICONS as readonly string[]).includes(value)
}

/** Not a type guard on purpose: an avatar that is no picture can still be an icon. */
export function isBotPicture(value: string | null): boolean {
  return value !== null && value.startsWith('data:image/png;base64,')
}
