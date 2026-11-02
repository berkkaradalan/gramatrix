import {
  Bot as BotIcon,
  ChevronLeft,
  Ellipsis,
  FolderOpen,
  MessageSquare,
  Pencil,
  Plus,
  SquarePen,
  Trash2
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { BotInput } from '@shared/rpc'
import { SOUL_LIMIT, type Bot, type BotMemory, type MemoryKind, type ModelRef } from '@shared/types'
import { BotAvatar } from '../components/BotChip'
import { findModel, ModelPicker } from '../components/ModelPicker'
import {
  Banner,
  Button,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Menu,
  PageHeader,
  Skeleton,
  Switch
} from '../components/ui'
import {
  MEMORY_KIND_HINTS,
  MEMORY_KIND_LABELS,
  MEMORY_KIND_ORDER,
  memoryOverflow,
  memoryUsage,
  readableMemoryError,
  soulPreview
} from '../lib/bots'
import { errorMessage, formatAge } from '../lib/format'
import { resolveDefaultModel, useApp } from '../state/app-context'
import { invoke, useAction, useHostEvent, useQuery } from '../state/hooks'
import { modelStore, useModelEntries } from '../state/model-store'
import { useNavigation } from '../state/navigation'
import { useOverlays } from '../state/overlays'
import { toast } from '../state/toasts'

const NAME_LIMIT = 40
const NUMBER = new Intl.NumberFormat('en-US')

const LEARN_HINT =
  'Now and then the bot reviews its chats and updates its memory. This uses tokens from your key.'

function BotDialog({
  open,
  bot,
  onOpenChange,
  onSaved
}: {
  open: boolean
  bot: Bot | null
  onOpenChange(open: boolean): void
  onSaved?(bot: Bot): void
}): ReactNode {
  const { settings, providers, reloadBots } = useApp()
  const [name, setName] = useState('')
  const [soul, setSoul] = useState('')
  const [model, setModel] = useState<ModelRef | null>(null)
  const [learns, setLearns] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(bot?.name ?? '')
    setSoul(bot?.soul ?? '')
    setModel(bot?.model ?? resolveDefaultModel(settings, providers))
    setLearns(bot?.learns ?? false)
    setError(null)
    // Only opening resets the form. Later changes to settings must not wipe what was typed.
  }, [open, bot])

  const soulLength = soul.trim().length
  const soulTooLong = soulLength > SOUL_LIMIT
  const canSave = Boolean(name.trim() && model && !soulTooLong && !busy)

  const save = async (): Promise<void> => {
    if (!canSave || !model) return
    const input: BotInput = { name: name.trim(), soul: soul.trim(), model, learns }
    setBusy(true)
    setError(null)
    try {
      const saved = bot
        ? await invoke('bots.update', { id: bot.id, patch: input })
        : await invoke('bots.create', input)
      await reloadBots()
      toast.success(bot ? `${saved.name} saved.` : `${saved.name} is ready.`)
      onOpenChange(false)
      onSaved?.(saved)
    } catch (caught) {
      // Shown in the form, next to what needs fixing, instead of a toast that disappears.
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      wide
      open={open}
      onOpenChange={onOpenChange}
      title={bot ? `Edit ${bot.name}` : 'New bot'}
      description={
        bot
          ? undefined
          : 'A bot has its own name, personality and a memory that lasts between chats.'
      }
    >
      <form
        className="stack-large"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <Field label="Name">
          {(id) => (
            <input
              id={id}
              className="input"
              autoFocus
              maxLength={NAME_LIMIT}
              placeholder="Atlas"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field
          label="Soul"
          hint={
            <span className="field-hint-row">
              <span>
                Who the bot is and how it should behave, in your own words. It goes into every
                request, so keep it short.
              </span>
              <span
                className={soulTooLong ? 'field-counter field-counter-over' : 'field-counter'}
                aria-live="polite"
              >
                {NUMBER.format(soulLength)} / {NUMBER.format(SOUL_LIMIT)}
              </span>
            </span>
          }
        >
          {(id) => (
            <textarea
              id={id}
              className="input textarea"
              rows={6}
              aria-invalid={soulTooLong}
              placeholder="You are calm and direct. Answer briefly and point out risks before you change anything."
              value={soul}
              onChange={(event) => setSoul(event.target.value)}
            />
          )}
        </Field>
        <Field label="Model" hint="New chats with this bot start with this model.">
          {(id) => <ModelPicker id={id} block value={model} onChange={setModel} />}
        </Field>
        <Switch label="Learn from chats" hint={LEARN_HINT} checked={learns} onChange={setLearns} />
        {error && <Banner tone="error">{error}</Banner>}
        <div className="row row-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!canSave}>
            {bot ? 'Save changes' : 'Create bot'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Deletes a bot after a confirmation, then returns to the list. */
function useDeleteBot(bot: Bot): () => Promise<void> {
  const { reloadBots, reloadChats } = useApp()
  const { route, navigate } = useNavigation()
  const { confirm } = useOverlays()
  const { run } = useAction()

  return async () => {
    const confirmed = await confirm({
      title: `Delete ${bot.name}?`,
      body: `Its chats stay and become plain Gramatrix chats. Its memory is deleted for good.`,
      action: 'Delete bot'
    })
    if (!confirmed) return
    await run(async () => {
      await invoke('bots.remove', { id: bot.id })
      await Promise.all([reloadBots(), reloadChats()])
      if (route.view === 'bot') navigate({ view: 'bots' })
      toast.success(`${bot.name} was deleted.`)
    })
  }
}

function useModelName(model: ModelRef): string {
  const entries = useModelEntries()
  useEffect(() => {
    void modelStore.load(model.provider)
  }, [model.provider])
  return findModel(entries, model).name
}

function BotRow({ bot, onEdit }: { bot: Bot; onEdit(): void }): ReactNode {
  const { navigate, newChat } = useNavigation()
  const remove = useDeleteBot(bot)
  const modelName = useModelName(bot.model)
  const open = (): void => navigate({ view: 'bot', botId: bot.id })

  return (
    <li>
      <div className="list-row">
        <button type="button" className="bot-row-open" onClick={open}>
          <BotAvatar name={bot.name} />
          <span className="list-row-main">
            <span className="bot-row-name">{bot.name}</span>
            <span className="bot-row-soul muted">{soulPreview(bot.soul) || 'No soul yet'}</span>
          </span>
        </button>
        <span className="project-tag">{modelName}</span>
        <IconButton
          icon={SquarePen}
          label={`New chat with ${bot.name}`}
          onClick={() => newChat(null, bot.id)}
        />
        <Menu
          actions={[
            { label: 'Open', icon: BotIcon, onSelect: open },
            { label: 'Edit', icon: Pencil, onSelect: onEdit },
            { label: 'Delete', icon: Trash2, danger: true, onSelect: () => void remove() }
          ]}
        >
          <IconButton icon={Ellipsis} label={`Actions for ${bot.name}`} />
        </Menu>
      </div>
    </li>
  )
}

export function BotsView({ createOnOpen = false }: { createOnOpen?: boolean }): ReactNode {
  const { bots, botsLoaded, botsError, reloadBots } = useApp()
  const { navigate } = useNavigation()
  const [dialog, setDialog] = useState<{ bot: Bot | null } | null>(
    createOnOpen ? { bot: null } : null
  )

  const newBot = (
    <Button variant="primary" icon={Plus} onClick={() => setDialog({ bot: null })}>
      New bot
    </Button>
  )

  return (
    <div className="page">
      <div className="page-column">
        <PageHeader
          title="Bots"
          description="Agents with their own personality and a memory that lasts between chats."
          action={bots.length > 0 && newBot}
        />
        {botsError && (
          <Banner
            tone="error"
            action={<Button onClick={() => void reloadBots()}>Try again</Button>}
          >
            Could not load bots: {botsError}
          </Banner>
        )}
        {!botsLoaded && <Skeleton rows={3} />}
        {botsLoaded && !botsError && bots.length === 0 && (
          <EmptyState icon={BotIcon} title="No bots yet" action={newBot}>
            Give one a name and a soul, and it remembers who you are and how you like to work.
          </EmptyState>
        )}
        {bots.length > 0 && (
          <ul className="list list-plain">
            {bots.map((bot) => (
              <BotRow key={bot.id} bot={bot} onEdit={() => setDialog({ bot })} />
            ))}
          </ul>
        )}
      </div>
      <BotDialog
        open={dialog !== null}
        bot={dialog?.bot ?? null}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
        onSaved={(saved) => {
          // A new bot opens on its own page, where its first chat is one click away.
          if (!dialog?.bot) navigate({ view: 'bot', botId: saved.id })
        }}
      />
    </div>
  )
}

function MemoryEditor({
  memories,
  kind,
  entry,
  botId,
  onDone
}: {
  memories: BotMemory[]
  kind: MemoryKind
  entry?: BotMemory
  botId: string
  onDone(): void
}): ReactNode {
  const [text, setText] = useState(entry?.content ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { used, limit } = memoryUsage(memories, kind)
  const overflow = memoryOverflow(memories, kind, text, entry)
  const left = limit - used + (entry?.content.length ?? 0) - text.trim().length
  const canSave = Boolean(text.trim()) && overflow === 0 && !busy
  const label = MEMORY_KIND_LABELS[kind]

  const save = async (): Promise<void> => {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      if (entry) await invoke('bots.updateMemory', { id: entry.id, content: text })
      else await invoke('bots.addMemory', { botId, kind, content: text })
      onDone()
    } catch (caught) {
      setError(readableMemoryError(errorMessage(caught)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="memory-editor"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <textarea
        className="input textarea"
        rows={2}
        autoFocus
        aria-label={entry ? `Edit entry in ${label}` : `New entry in ${label}`}
        aria-invalid={overflow > 0}
        placeholder={
          kind === 'user' ? 'Prefers short answers with code first' : 'The api uses pnpm, not npm'
        }
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void save()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onDone()
          }
        }}
      />
      <div className="row row-nowrap">
        <span className={overflow > 0 ? 'hint memory-over' : 'hint'}>
          {overflow > 0
            ? `${NUMBER.format(overflow)} characters too long. Shorten it or remove another entry.`
            : `${NUMBER.format(left)} characters left`}
        </span>
        <span className="spacer" />
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!canSave}>
          {entry ? 'Save' : 'Add'}
        </Button>
      </div>
      {error && <Banner tone="error">{error}</Banner>}
    </form>
  )
}

function MemoryEntry({
  entry,
  memories,
  editing,
  onEdit,
  onDone
}: {
  entry: BotMemory
  memories: BotMemory[]
  editing: boolean
  onEdit(): void
  onDone(): void
}): ReactNode {
  const { confirm } = useOverlays()
  const { busy, run } = useAction()

  const remove = async (): Promise<void> => {
    const confirmed = await confirm({
      title: 'Delete this entry?',
      body: `"${entry.content}" is removed from memory, and the bot no longer sees it.`,
      action: 'Delete entry'
    })
    if (confirmed) await run(() => invoke('bots.removeMemory', { id: entry.id }))
  }

  if (editing) {
    return (
      <li className="memory-entry">
        <MemoryEditor
          memories={memories}
          kind={entry.kind}
          entry={entry}
          botId={entry.botId}
          onDone={onDone}
        />
      </li>
    )
  }
  return (
    <li className="memory-entry">
      <p className="memory-text">{entry.content}</p>
      <span className="memory-actions">
        <IconButton size="small" icon={Pencil} label="Edit entry" onClick={onEdit} />
        <IconButton
          size="small"
          icon={Trash2}
          label="Delete entry"
          disabled={busy}
          onClick={() => void remove()}
        />
      </span>
    </li>
  )
}

function MemoryGroup({
  botId,
  kind,
  memories
}: {
  botId: string
  kind: MemoryKind
  memories: BotMemory[]
}): ReactNode {
  // One editor at a time: an entry id, 'new' for the add form, or null.
  const [editing, setEditing] = useState<string | null>(null)
  const entries = memories.filter((memory) => memory.kind === kind)
  const { used, limit, ratio } = memoryUsage(memories, kind)
  const label = MEMORY_KIND_LABELS[kind]
  const tone = ratio >= 0.9 ? 'memory-meter memory-meter-high' : 'memory-meter'

  return (
    <section className="memory-group" aria-label={label}>
      <header className="memory-head">
        <div>
          <h3>{label}</h3>
          <p className="hint">{MEMORY_KIND_HINTS[kind]}</p>
        </div>
        <span className="memory-count">
          {NUMBER.format(used)} of {NUMBER.format(limit)} characters
        </span>
      </header>
      <div
        className={tone}
        role="meter"
        aria-label={`${label} memory used`}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
      >
        <span style={{ width: `${ratio * 100}%` }} />
      </div>
      {entries.length === 0 && editing !== 'new' && (
        <p className="muted memory-empty">Nothing here yet.</p>
      )}
      {entries.length > 0 && (
        <ul className="memory-list list-plain">
          {entries.map((entry) => (
            <MemoryEntry
              key={entry.id}
              entry={entry}
              memories={memories}
              editing={editing === entry.id}
              onEdit={() => setEditing(entry.id)}
              onDone={() => setEditing(null)}
            />
          ))}
        </ul>
      )}
      {editing === 'new' ? (
        <MemoryEditor
          memories={memories}
          kind={kind}
          botId={botId}
          onDone={() => setEditing(null)}
        />
      ) : (
        <div>
          <Button variant="ghost" icon={Plus} onClick={() => setEditing('new')}>
            Add to {label}
          </Button>
        </div>
      )}
    </section>
  )
}

function MemorySection({ bot }: { bot: Bot }): ReactNode {
  const memories = useQuery(() => invoke('bots.memories', { botId: bot.id }), [bot.id])
  // The bot writes memory during chats, so the page follows along.
  useHostEvent('bots.changed', ({ botId }) => {
    if (botId === bot.id) void memories.reload()
  })

  return (
    <section className="stack" aria-label="Memory">
      <div>
        <h2>Memory</h2>
        <p className="hint">
          {bot.name} sees this at the start of every chat and adds to it when it learns something
          lasting. You can change it too.
        </p>
      </div>
      {memories.error && (
        <Banner
          tone="error"
          action={<Button onClick={() => void memories.reload()}>Try again</Button>}
        >
          Could not load the memory: {memories.error}
        </Banner>
      )}
      {memories.loading && !memories.data && <Skeleton rows={3} />}
      {memories.data &&
        MEMORY_KIND_ORDER.map((kind) => (
          <MemoryGroup key={kind} botId={bot.id} kind={kind} memories={memories.data ?? []} />
        ))}
    </section>
  )
}

function BotChats({ bot }: { bot: Bot }): ReactNode {
  const { chats, projects } = useApp()
  const { navigate, newChat } = useNavigation()
  const botChats = chats.filter(({ botId }) => botId === bot.id)

  return (
    <section className="stack-small" aria-label={`Chats with ${bot.name}`}>
      <h2>Chats</h2>
      {botChats.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No chats yet"
          action={
            <Button icon={SquarePen} onClick={() => newChat(null, bot.id)}>
              Start a chat
            </Button>
          }
        >
          Chats with {bot.name} show up here.
        </EmptyState>
      ) : (
        <ul className="list list-plain">
          {botChats.map((chat) => {
            const project = projects.find(({ id }) => id === chat.projectId)
            return (
              <li key={chat.id}>
                <button
                  type="button"
                  className="list-link"
                  onClick={() => navigate({ view: 'chat', chatId: chat.id })}
                >
                  <MessageSquare size={15} aria-hidden />
                  <span className="side-label">{chat.title}</span>
                  {project && (
                    <span className="project-tag">
                      <FolderOpen size={13} aria-hidden />
                      {project.name}
                    </span>
                  )}
                  <span className="side-age">{formatAge(chat.updatedAt)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export function BotView({ bot }: { bot: Bot }): ReactNode {
  const { navigate, newChat } = useNavigation()
  const { run } = useAction()
  const [editing, setEditing] = useState(false)
  const remove = useDeleteBot(bot)
  const modelName = useModelName(bot.model)

  const setLearns = (learns: boolean): Promise<unknown> =>
    run(() => invoke('bots.update', { id: bot.id, patch: { learns } }))

  return (
    <div className="page">
      <div className="page-column">
        <button
          type="button"
          className="link-quiet back-link"
          onClick={() => navigate({ view: 'bots' })}
        >
          <ChevronLeft size={15} aria-hidden />
          Bots
        </button>
        <header className="page-header">
          <div className="bot-title">
            <BotAvatar name={bot.name} size="large" />
            <div>
              <h1>{bot.name}</h1>
              <p className="muted">{modelName}</p>
            </div>
          </div>
          <div className="row row-nowrap">
            <Button icon={Pencil} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="primary" icon={SquarePen} onClick={() => newChat(null, bot.id)}>
              New chat
            </Button>
            <Menu
              actions={[
                { label: 'Delete bot', icon: Trash2, danger: true, onSelect: () => void remove() }
              ]}
            >
              <IconButton icon={Ellipsis} label={`More actions for ${bot.name}`} />
            </Menu>
          </div>
        </header>

        <section className="stack-small" aria-label="Soul">
          <h2>Soul</h2>
          {bot.soul ? (
            <p className="soul">{bot.soul}</p>
          ) : (
            <p className="soul soul-empty">
              No soul yet, so {bot.name} acts like plain Gramatrix.{' '}
              <button type="button" className="link" onClick={() => setEditing(true)}>
                Describe who it is
              </button>
            </p>
          )}
        </section>

        <div className="bot-setting">
          <Switch
            label="Learn from chats"
            hint={LEARN_HINT}
            checked={bot.learns}
            onChange={(learns) => void setLearns(learns)}
          />
        </div>

        <MemorySection bot={bot} />
        <BotChats bot={bot} />
      </div>
      <BotDialog open={editing} bot={bot} onOpenChange={setEditing} />
    </div>
  )
}
