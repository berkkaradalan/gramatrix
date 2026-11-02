import * as RadixMenu from '@radix-ui/react-dropdown-menu'
import { Bot as BotIcon, Check, ChevronDown, Plus, Settings2, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { botInitial, soulPreview } from '../lib/bots'
import { BOT_ICON_DETAILS, isBotIcon, isBotPicture } from './bot-icons'
import { useApp } from '../state/app-context'
import { useNavigation } from '../state/navigation'

/**
 * Stands for a bot wherever it appears: its picture, one of the icons that come with the app, or
 * the first letter of its name.
 */
export function BotAvatar({
  name,
  avatar = null,
  size = 'medium'
}: {
  name: string
  avatar?: string | null
  size?: 'small' | 'medium' | 'large'
}): ReactNode {
  const className = `bot-avatar bot-avatar-${size}`
  if (avatar !== null && isBotPicture(avatar)) {
    return <img className={`${className} bot-avatar-picture`} src={avatar} alt="" aria-hidden />
  }
  if (isBotIcon(avatar)) {
    const { icon: Icon } = BOT_ICON_DETAILS[avatar]
    return (
      <span className={`${className} bot-avatar-icon`} aria-hidden>
        <Icon />
      </span>
    )
  }
  return (
    <span className={className} aria-hidden>
      {botInitial(name)}
    </span>
  )
}

/** Chooses who a new chat talks to: plain Gramatrix or one of the bots. */
export function BotChip({
  botId,
  onChange
}: {
  botId: string | null
  onChange(botId: string | null): void
}): ReactNode {
  const { bots } = useApp()
  const { navigate } = useNavigation()
  const bot = bots.find(({ id }) => id === botId)

  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild>
        <button type="button" className="chip" aria-label={`Bot: ${bot?.name ?? 'No bot'}`}>
          {bot ? (
            <BotAvatar name={bot.name} avatar={bot.avatar} size="small" />
          ) : (
            <BotIcon size={14} aria-hidden />
          )}
          <span className="chip-label">{bot?.name ?? 'No bot'}</span>
          <ChevronDown size={13} aria-hidden />
        </button>
      </RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content className="popover menu menu-wide" align="start" sideOffset={6}>
          <RadixMenu.Item className="menu-item" onSelect={() => onChange(null)}>
            <Sparkles size={15} aria-hidden />
            <span className="menu-item-text">
              No bot
              <span className="menu-item-hint">Plain Gramatrix chat, no memory</span>
            </span>
            {bot === undefined && <Check className="menu-item-check" size={14} aria-hidden />}
          </RadixMenu.Item>
          {bots.length > 0 && <RadixMenu.Separator className="menu-separator" />}
          {bots.map((candidate) => (
            <RadixMenu.Item
              key={candidate.id}
              className="menu-item"
              onSelect={() => onChange(candidate.id)}
            >
              <BotAvatar name={candidate.name} avatar={candidate.avatar} size="small" />
              <span className="menu-item-text">
                {candidate.name}
                <span className="menu-item-hint">
                  {soulPreview(candidate.soul) || 'Remembers you between chats'}
                </span>
              </span>
              {candidate.id === bot?.id && (
                <Check className="menu-item-check" size={14} aria-hidden />
              )}
            </RadixMenu.Item>
          ))}
          <RadixMenu.Separator className="menu-separator" />
          <RadixMenu.Item
            className="menu-item"
            onSelect={() => navigate({ view: 'bots', create: bots.length === 0 })}
          >
            {bots.length === 0 ? (
              <Plus size={15} aria-hidden />
            ) : (
              <Settings2 size={15} aria-hidden />
            )}
            <span className="menu-item-text">
              {bots.length === 0 ? 'Create a bot' : 'Manage bots'}
            </span>
          </RadixMenu.Item>
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  )
}
