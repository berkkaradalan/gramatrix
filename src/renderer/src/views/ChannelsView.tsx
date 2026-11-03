import {
  Check,
  ExternalLink,
  Hash,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useState, type ReactNode } from 'react'
import { secretName, type PairingCode } from '@shared/rpc'
import {
  CHANNEL_KINDS,
  type Channel,
  type ChannelKind,
  type ChannelPairing,
  type ChannelState
} from '@shared/types'
import { BotAvatar } from '../components/BotChip'
import { ModelPicker } from '../components/ModelPicker'
import { PermissionControl } from '../components/PermissionControl'
import {
  Badge,
  Banner,
  Button,
  CopyButton,
  Dialog,
  Field,
  IconButton,
  PageHeader,
  Select,
  Skeleton,
  StatusDot,
  Switch
} from '../components/ui'
import { formatDateTime } from '../lib/format'
import { CHANNEL_LABELS, CHANNEL_STATE_LABELS, PERMISSION_HINTS } from '../lib/labels'
import { useApp } from '../state/app-context'
import { invoke, useAction, useHostEvent, useQuery } from '../state/hooks'
import { useOverlays } from '../state/overlays'

interface TokenField {
  field: string
  label: string
  hint: string
}

interface ChannelGuide {
  icon: LucideIcon
  description: string
  /** Short steps to get the tokens, shown above the token fields. */
  connect: ReactNode[]
  tokens: TokenField[]
}

function OutsideLink({ url, children }: { url: string; children: ReactNode }): ReactNode {
  return (
    <button type="button" className="link" onClick={() => void invoke('app.openExternal', { url })}>
      {children} <ExternalLink size={12} aria-hidden />
    </button>
  )
}

const GUIDES: Record<ChannelKind, ChannelGuide> = {
  telegram: {
    icon: Send,
    description: 'Message your agent from a private Telegram bot.',
    connect: [
      <>
        Open <OutsideLink url="https://t.me/BotFather">@BotFather</OutsideLink> in Telegram and send{' '}
        <code>/newbot</code>.
      </>,
      'Pick a name and a user name for the bot. BotFather answers with a token.',
      'Paste the token here.'
    ],
    tokens: [{ field: 'botToken', label: 'Bot token', hint: 'It looks like 123456:ABC-DEF...' }]
  },
  slack: {
    icon: Hash,
    description: 'Mention your agent in Slack, using Socket Mode.',
    connect: [
      <>
        Create an app at <OutsideLink url="https://api.slack.com/apps">api.slack.com</OutsideLink>{' '}
        and turn on Socket Mode.
      </>,
      <>
        Add the events and scopes from the{' '}
        <OutsideLink url="https://gramatrix.com/docs/channels/">setup guide</OutsideLink>, then
        install the app to your workspace.
      </>,
      'Paste both tokens here.'
    ],
    tokens: [
      { field: 'botToken', label: 'Bot token', hint: 'Starts with xoxb-.' },
      { field: 'appToken', label: 'App token', hint: 'Starts with xapp-.' }
    ]
  }
}

const STATE_TONE: Record<ChannelState, 'off' | 'busy' | 'ok' | 'error'> = {
  disabled: 'off',
  connecting: 'busy',
  connected: 'ok',
  error: 'error'
}

const NO_PROJECT = 'none'
/** Select value for plain Gramatrix. Bot ids are UUIDs, so they never collide with it. */
const NO_BOT = 'gramatrix'

/** Where the bot is, in the words shown under the status. */
function connectionText(channel: Channel, tokensSaved: boolean): string {
  if (!tokensSaved) return 'Not set up yet'
  if (channel.state === 'connected') {
    return channel.account ? `Connected as @${channel.account}` : 'Connected'
  }
  return CHANNEL_STATE_LABELS[channel.state]
}

function Step({
  number,
  title,
  done = false,
  disabledHint,
  children
}: {
  number: number
  title: string
  done?: boolean
  /** Shown instead of the content while an earlier step is missing. */
  disabledHint?: string
  children: ReactNode
}): ReactNode {
  return (
    <section
      className={`setup-step${disabledHint ? ' setup-step-waiting' : ''}`}
      aria-label={title}
    >
      <span className={`setup-number${done ? ' setup-number-done' : ''}`}>
        {done ? <Check size={13} aria-label="Done" /> : number}
      </span>
      <div className="setup-body">
        <h3>{title}</h3>
        {disabledHint ? <p className="hint">{disabledHint}</p> : children}
      </div>
    </section>
  )
}

function TokenInput({
  kind,
  token,
  saved,
  onSaved
}: {
  kind: ChannelKind
  token: TokenField
  saved: boolean
  onSaved(): Promise<void>
}): ReactNode {
  const name = secretName.channel(kind, token.field)
  const [value, setValue] = useState('')
  const { busy, run } = useAction()

  const save = (): Promise<unknown> =>
    run(async () => {
      await invoke('secrets.set', { name, value: value.trim() })
      setValue('')
      await onSaved()
    })
  const remove = (): Promise<unknown> =>
    run(async () => {
      await invoke('secrets.delete', { name })
      await onSaved()
    })

  return (
    <Field label={token.label} hint={token.hint}>
      {(id) => (
        <form
          className="row row-nowrap"
          onSubmit={(event) => {
            event.preventDefault()
            if (value.trim()) void save()
          }}
        >
          <input
            id={id}
            className="input input-mono grow"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={saved ? 'Saved. Paste a new token to replace it.' : ''}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          {saved && !value ? (
            <IconButton
              icon={Trash2}
              label={`Remove ${token.label}`}
              disabled={busy}
              onClick={() => void remove()}
            />
          ) : (
            <Button type="submit" variant="primary" disabled={busy || !value.trim()}>
              Save
            </Button>
          )}
        </form>
      )}
    </Field>
  )
}

/** Whether each token of a channel is saved, in the order of the guide. */
function useSavedTokens(kind: ChannelKind): { saved: boolean[] | null; reload(): Promise<void> } {
  const query = useQuery(() => readSavedTokens(kind), [kind])
  return { saved: query.data ?? null, reload: query.reload }
}

function readSavedTokens(kind: ChannelKind): Promise<boolean[]> {
  return Promise.all(
    GUIDES[kind].tokens.map(({ field }) =>
      invoke('secrets.has', { name: secretName.channel(kind, field) })
    )
  )
}

/** Seconds left until `expiresAt`, updated every second. */
function useSecondsLeft(expiresAt: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (expiresAt === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [expiresAt])
  return expiresAt === null ? 0 : Math.max(0, Math.round((expiresAt - now) / 1000))
}

function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** The pairing link as a QR code, black on white so every phone camera can read it. */
function QrCode({ text }: { text: string }): ReactNode {
  const [source, setSource] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    void QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(
      (svg) => {
        if (current) setSource(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
      }
    )
    return () => {
      current = false
    }
  }, [text])
  return source ? (
    <img className="pairing-qr" src={source} alt="QR code of the pairing link" />
  ) : (
    <span className="pairing-qr" />
  )
}

/** A code that is waiting for someone to send it, with the quickest way to send it. */
function PendingCode({
  kind,
  pairing,
  account,
  onRenew
}: {
  kind: ChannelKind
  pairing: PairingCode
  account: string | null
  onRenew(): void
}): ReactNode {
  const secondsLeft = useSecondsLeft(pairing.expiresAt)
  // Slack treats any message that starts with / as one of its own commands, so it gets the code.
  const message = kind === 'telegram' ? `/pair ${pairing.code}` : pairing.code
  const where = account ? `@${account}` : 'the bot'

  if (secondsLeft === 0) {
    return (
      <Banner tone="warning" action={<Button onClick={onRenew}>Create a new code</Button>}>
        This code expired. Codes work for 10 minutes.
      </Banner>
    )
  }

  return (
    <div className="pairing-card" aria-live="polite">
      {pairing.link && <QrCode text={pairing.link} />}
      <div className="stack">
        {pairing.link ? (
          <>
            <p>
              Scan the code with your phone, or open the link on this computer. Then press Start.
            </p>
            <div className="row">
              <Button
                variant="primary"
                icon={Send}
                onClick={() => void invoke('app.openExternal', { url: pairing.link ?? '' })}
              >
                Open in Telegram
              </Button>
            </div>
          </>
        ) : (
          <p>Send this code to {where} in a direct message.</p>
        )}
        <div className="code-box">
          <div>
            <p className="hint">
              {pairing.link ? `Or send this message to ${where}` : 'Pairing code'}
            </p>
            <code>{message}</code>
          </div>
          <CopyButton text={message} label="Copy" />
        </div>
        <p className="hint pairing-waiting">
          <StatusDot tone="busy" />
          Waiting for you in {CHANNEL_LABELS[kind]}. The code works once, for{' '}
          {formatCountdown(secondsLeft)} more.
        </p>
      </div>
    </div>
  )
}

function Pairing({ channel }: { channel: Channel }): ReactNode {
  const { kind } = channel
  const { confirm } = useOverlays()
  const pairings = useQuery(() => invoke('channels.pairings', { kind }), [kind])
  /** The code being offered, and who was already paired when it was made. */
  const [pending, setPending] = useState<{ code: PairingCode; known: Set<string> } | null>(null)
  const [justPaired, setJustPaired] = useState<ChannelPairing | null>(null)
  const { busy, run } = useAction()

  // Pairing happens in the chat app, and the host reports it at once.
  useHostEvent('channels.changed', () => void pairings.reload())
  useEffect(() => {
    if (!pending || !pairings.data) return
    const newcomer = pairings.data.find(({ externalUserId }) => !pending.known.has(externalUserId))
    if (newcomer) {
      setPending(null)
      setJustPaired(newcomer)
    }
  }, [pairings.data, pending])

  const createCode = (): Promise<unknown> =>
    run(async () => {
      const known = new Set((pairings.data ?? []).map(({ externalUserId }) => externalUserId))
      const code = await invoke('channels.createPairingCode', { kind })
      setJustPaired(null)
      setPending({ code, known })
    })

  const revoke = async ({ externalUserId, displayName }: ChannelPairing): Promise<void> => {
    const confirmed = await confirm({
      title: `Revoke ${displayName}?`,
      body: `${displayName} can no longer use the agent from ${CHANNEL_LABELS[kind]}.`,
      action: 'Revoke'
    })
    if (!confirmed) return
    await run(async () => {
      await invoke('channels.revokePairing', { kind, externalUserId })
      await pairings.reload()
    })
  }

  const paired = pairings.data ?? []

  return (
    <div className="stack">
      {justPaired && (
        <Banner tone="success">
          Paired with {justPaired.displayName}. Say hello to your bot in {CHANNEL_LABELS[kind]}
          {kind === 'telegram' ? ', or send /help to see its commands.' : '.'}
        </Banner>
      )}
      {pairings.loading && !pairings.data && <Skeleton rows={1} />}
      {pairings.error && <Banner tone="error">{pairings.error}</Banner>}
      {paired.length > 0 && (
        <ul className="run-list" aria-label="Paired accounts">
          {paired.map((pairing) => (
            <li key={pairing.externalUserId}>
              <span>{pairing.displayName}</span>
              <span className="muted">Paired {formatDateTime(pairing.pairedAt)}</span>
              <span className="spacer" />
              <Button variant="ghost" disabled={busy} onClick={() => void revoke(pairing)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
      {pending ? (
        <PendingCode
          kind={kind}
          pairing={pending.code}
          account={channel.account}
          onRenew={() => void createCode()}
        />
      ) : (
        <>
          {paired.length === 0 && (
            <p className="hint">
              Only paired accounts can talk to the agent. Pair only accounts you trust: they can
              reach your project.
            </p>
          )}
          <div className="row">
            <Button
              variant={paired.length === 0 ? 'primary' : 'default'}
              disabled={busy}
              onClick={() => void createCode()}
            >
              {paired.length === 0 ? 'Pair my account' : 'Pair another account'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function SetupDialog({
  channel,
  open,
  onOpenChange
}: {
  channel: Channel
  open: boolean
  onOpenChange(open: boolean): void
}): ReactNode {
  const { projects, bots } = useApp()
  const { run } = useAction()
  const guide = GUIDES[channel.kind]
  const tokens = useSavedTokens(channel.kind)
  const tokensSaved = tokens.saved?.every(Boolean) ?? false
  const connected = channel.state === 'connected'

  const configure = (patch: Partial<Channel>): Promise<unknown> => {
    const next = { ...channel, ...patch }
    return run(() =>
      invoke('channels.configure', {
        kind: next.kind,
        enabled: next.enabled,
        projectId: next.projectId,
        model: next.model,
        permissionMode: next.permissionMode,
        botId: next.botId
      })
    )
  }

  // Saving the last token turns the channel on, which connects with it. Removing one turns it off.
  const tokensChanged = async (): Promise<void> => {
    const everySaved = (await readSavedTokens(channel.kind)).every(Boolean)
    await tokens.reload()
    await configure({ enabled: everySaved })
  }

  // Like a new chat, picking a bot also picks its model. The model can still be changed after.
  const chooseBot = (value: string): Promise<unknown> => {
    const bot = bots.find(({ id }) => id === value)
    return configure(bot ? { botId: bot.id, model: bot.model } : { botId: null })
  }

  return (
    <Dialog
      wide
      open={open}
      onOpenChange={onOpenChange}
      title={`Set up ${CHANNEL_LABELS[channel.kind]}`}
      description={guide.description}
    >
      <div className="setup">
        <div className="setup-status">
          <StatusDot tone={STATE_TONE[channel.state]} />
          <span>{connectionText(channel, tokensSaved)}</span>
          <span className="spacer" />
          <Switch
            label={channel.enabled ? 'On' : 'Off'}
            checked={channel.enabled}
            disabled={!tokensSaved}
            onChange={(enabled) => void configure({ enabled })}
          />
        </div>
        {channel.error && <Banner tone="error">{channel.error}</Banner>}

        <Step number={1} title="Connect your bot" done={connected}>
          {!tokensSaved && (
            <ol className="setup-instructions">
              {guide.connect.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ol>
          )}
          {guide.tokens.map((token, index) => (
            <TokenInput
              key={token.field}
              kind={channel.kind}
              token={token}
              saved={tokens.saved?.[index] === true}
              onSaved={tokensChanged}
            />
          ))}
        </Step>

        <Step
          number={2}
          title="Pair your account"
          disabledHint={connected ? undefined : 'Connect the bot first, then pair here.'}
        >
          <Pairing channel={channel} />
        </Step>

        <Step number={3} title="Choose how it answers">
          {channel.kind === 'telegram' && (
            <p className="muted">
              These apply to every chat. In a chat, /model, /project, /bot and /mode change them for
              that chat only.
            </p>
          )}
          <Field
            label="Answers as"
            hint="Plain Gramatrix, or one of your bots. A bot uses its memory only in direct messages with you, never in groups."
          >
            {(id) => (
              <Select
                id={id}
                value={channel.botId ?? NO_BOT}
                options={[
                  {
                    value: NO_BOT,
                    label: 'Gramatrix',
                    hint: 'No personality, no memory',
                    icon: <Sparkles size={15} aria-hidden />
                  },
                  ...bots.map((bot) => ({
                    value: bot.id,
                    label: bot.name,
                    icon: <BotAvatar name={bot.name} avatar={bot.avatar} size="small" />
                  }))
                ]}
                onChange={(value) => void chooseBot(value)}
              />
            )}
          </Field>
          <div className="grid-two">
            <Field label="Project" hint="The folder messages can work in.">
              {(id) => (
                <Select
                  id={id}
                  value={channel.projectId ?? NO_PROJECT}
                  options={[
                    { value: NO_PROJECT, label: 'No project', hint: 'Conversation only' },
                    ...projects.map((project) => ({
                      value: project.id,
                      label: project.name,
                      hint: project.path
                    }))
                  ]}
                  onChange={(value) =>
                    void configure({ projectId: value === NO_PROJECT ? null : value })
                  }
                />
              )}
            </Field>
            <Field label="Model">
              {(id) => (
                <ModelPicker
                  id={id}
                  block
                  value={channel.model}
                  onChange={(model) => void configure({ model })}
                />
              )}
            </Field>
          </div>
          {/* Shown without a project too, because a chat can move to one with /project. */}
          <Field
            label="Permissions"
            hint={`${
              channel.permissionMode === 'ask'
                ? 'Approvals cannot be answered from a channel, so they are denied.'
                : PERMISSION_HINTS[channel.permissionMode]
            } A chat can only choose this mode or a safer one.`}
          >
            {(id) => (
              <PermissionControl
                id={id}
                value={channel.permissionMode}
                onChange={(permissionMode) => void configure({ permissionMode })}
              />
            )}
          </Field>
        </Step>
      </div>
    </Dialog>
  )
}

function ChannelCard({ channel }: { channel: Channel }): ReactNode {
  const [open, setOpen] = useState(false)
  const guide = GUIDES[channel.kind]
  const Icon = guide.icon
  const { projects, bots } = useApp()
  const project = projects.find(({ id }) => id === channel.projectId)
  const bot = bots.find(({ id }) => id === channel.botId)

  return (
    <article className="channel-card">
      <div className="channel-card-head">
        <span className="provider-card-logo">
          <Icon size={18} aria-hidden />
        </span>
        <Badge
          tone={
            channel.state === 'connected'
              ? 'accent'
              : channel.state === 'error'
                ? 'danger'
                : 'neutral'
          }
        >
          <StatusDot tone={STATE_TONE[channel.state]} />
          {CHANNEL_STATE_LABELS[channel.state]}
        </Badge>
      </div>
      <div>
        <h2>{CHANNEL_LABELS[channel.kind]}</h2>
        <p className="muted">{channel.account ? `@${channel.account}` : guide.description}</p>
      </div>
      {channel.error && <Banner tone="error">{channel.error}</Banner>}
      <p className="hint channel-card-where">
        {channel.enabled
          ? `${bot ? `${bot.name} answers` : 'Gramatrix answers'} in ${project?.name ?? 'plain conversation'}`
          : 'Not set up yet'}
      </p>
      <Button icon={channel.enabled ? Settings2 : undefined} onClick={() => setOpen(true)}>
        {channel.enabled ? 'Manage' : 'Set up'}
      </Button>
      <SetupDialog channel={channel} open={open} onOpenChange={setOpen} />
    </article>
  )
}

export function ChannelsView(): ReactNode {
  const channels = useQuery(() => invoke('channels.list', undefined), [])
  const [live, setLive] = useState<Channel[] | null>(null)
  useHostEvent('channels.changed', setLive)
  // Deleting a bot turns its channels back into plain Gramatrix without a channel event.
  useHostEvent('bots.changed', () => void channels.reload())
  useEffect(() => setLive(null), [channels.data])

  const list = live ?? channels.data ?? []
  const ordered = CHANNEL_KINDS.flatMap((kind) => list.filter((channel) => channel.kind === kind))

  return (
    <div className="page">
      <div className="page-column">
        <PageHeader
          title="Channels"
          description="Talk to your agent from chat apps while Gramatrix is running."
        />
        {channels.error && (
          <Banner
            tone="error"
            action={<Button onClick={() => void channels.reload()}>Try again</Button>}
          >
            Could not load channels: {channels.error}
          </Banner>
        )}
        {channels.loading && !channels.data && <Skeleton rows={3} />}
        <div className="channel-grid">
          {ordered.map((channel) => (
            <ChannelCard key={channel.kind} channel={channel} />
          ))}
        </div>
      </div>
    </div>
  )
}
