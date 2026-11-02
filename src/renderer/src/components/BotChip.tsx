import * as RadixMenu from '@radix-ui/react-dropdown-menu'
import { Bot as BotIcon, Check, ChevronDown, Plus, Settings2, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { botInitial, soulPreview } from '../lib/bots'
import { useApp } from '../state/app-context'
import { useNavigation } from '../state/navigation'

/** A round letter that stands for a bot wherever it appears. */
export function BotAvatar({
  name,
  size = 'medium'
}: {
  name: string
  size?: 'small' | 'medium' | 'large'
}): ReactNode {
  return (
    <span className={`bot-avatar bot-avatar-${size}`} aria-hidden>
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
          {bot ? <BotAvatar name={bot.name} size="small" /> : <BotIcon size={14} aria-hidden />}
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
              <BotAvatar name={candidate.name} size="small" />
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
