import { Hash, Send, Settings2, Trash2, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { secretName } from '@shared/rpc'
import { CHANNEL_KINDS, type Channel, type ChannelKind, type ChannelState } from '@shared/types'
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
import { toast } from '../state/toasts'

interface TokenField {
  field: string
  label: string
  hint: string
}

interface ChannelGuide {
  icon: LucideIcon
  description: string
  tokens: TokenField[]
}

const GUIDES: Record<ChannelKind, ChannelGuide> = {
  telegram: {
    icon: Send,
    description: 'Message your agent from a private Telegram bot.',
    tokens: [
      {
        field: 'botToken',
        label: 'Bot token',
        hint: 'Create a bot with @BotFather and paste the token it gives you.'
      }
    ]
  },
  slack: {
    icon: Hash,
    description: 'Mention your agent in Slack, using Socket Mode.',
    tokens: [
      { field: 'botToken', label: 'Bot token', hint: 'Starts with xoxb-.' },
      {
        field: 'appToken',
        label: 'App token',
        hint: 'Starts with xapp-. Enable Socket Mode in your Slack app first.'
      }
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

function Step({
  number,
  title,
  children
}: {
  number: number
  title: string
  children: ReactNode
}): ReactNode {
  return (
    <section className="setup-step" aria-label={title}>
      <span className="setup-number">{number}</span>
      <div className="setup-body">
        <h3>{title}</h3>
        {children}
      </div>
    </section>
  )
}

function TokenInput({ kind, token }: { kind: ChannelKind; token: TokenField }): ReactNode {
  const name = secretName.channel(kind, token.field)
  const saved = useQuery(() => invoke('secrets.has', { name }), [name])
  const [value, setValue] = useState('')
  const { busy, run } = useAction()

  const save = (): Promise<unknown> =>
    run(async () => {
      await invoke('secrets.set', { name, value: value.trim() })
      setValue('')
      await saved.reload()
      toast.success(`${token.label} saved.`)
    })
  const remove = (): Promise<unknown> =>
    run(async () => {
      await invoke('secrets.delete', { name })
      await saved.reload()
    })

  return (
    <Field label={token.label} hint={token.hint}>
      {(id) => (
        <div className="row row-nowrap">
          <input
            id={id}
            className="input input-mono grow"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={saved.data ? 'Saved. Paste a new token to replace it.' : ''}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          {saved.data && !value ? (
            <IconButton
              icon={Trash2}
              label={`Remove ${token.label}`}
              disabled={busy}
              onClick={() => void remove()}
            />
          ) : (
            <Button disabled={busy || !value.trim()} onClick={() => void save()}>
              Save
            </Button>
          )}
        </div>
      )}
    </Field>
  )
}

function Pairing({ kind }: { kind: ChannelKind }): ReactNode {
  const { confirm } = useOverlays()
  const pairings = useQuery(() => invoke('channels.pairings', { kind }), [kind])
  const [code, setCode] = useState<string | null>(null)
  const { busy, run } = useAction()
  useHostEvent('channels.changed', () => void pairings.reload())

  const createCode = (): Promise<unknown> =>
    run(async () => {
      const result = await invoke('channels.createPairingCode', { kind })
      setCode(result.code)
    })

  const revoke = async (externalUserId: string, displayName: string): Promise<void> => {
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

  const codeBox = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (code) codeBox.current?.scrollIntoView({ block: 'nearest' })
  }, [code])

  const message = code ? `/pair ${code}` : ''

  return (
    <div className="stack">
      <p className="hint">
        Only paired people can use the agent. Anyone you pair can reach your project, so pair only
        people you trust.
      </p>
      {pairings.loading && !pairings.data && <Skeleton rows={1} />}
      {pairings.error && <Banner tone="error">{pairings.error}</Banner>}
      {pairings.data && pairings.data.length > 0 && (
        <ul className="run-list">
          {pairings.data.map((pairing) => (
            <li key={pairing.externalUserId}>
              <span>{pairing.displayName}</span>
              <span className="muted">Paired {formatDateTime(pairing.pairedAt)}</span>
              <span className="spacer" />
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void revoke(pairing.externalUserId, pairing.displayName)}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
      {code && (
        <div className="code-box" ref={codeBox}>
          <div>
            <p className="hint">Send this to the bot within 10 minutes</p>
            <code>{message}</code>
          </div>
          <CopyButton text={message} label="Copy message" />
        </div>
      )}
      <div className="row">
        <Button disabled={busy} onClick={() => void createCode()}>
          {code ? 'Create a new code' : 'Create pairing code'}
        </Button>
      </div>
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
  const { projects } = useApp()
  const { run } = useAction()
  const guide = GUIDES[channel.kind]

  const configure = (patch: Partial<Channel>): Promise<unknown> => {
    const next = { ...channel, ...patch }
    return run(() =>
      invoke('channels.configure', {
        kind: next.kind,
        enabled: next.enabled,
        projectId: next.projectId,
        model: next.model,
        permissionMode: next.permissionMode
      })
    )
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
        <Step number={1} title="Connect the bot">
          {guide.tokens.map((token) => (
            <TokenInput key={token.field} kind={channel.kind} token={token} />
          ))}
        </Step>
        <Step number={2} title="Choose how it works">
          <div className="grid-two">
            <Field label="Project">
              {(id) => (
                <Select
                  id={id}
                  value={channel.projectId ?? NO_PROJECT}
                  options={[
                    { value: NO_PROJECT, label: 'No project', hint: 'Plain conversation' },
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
          {channel.projectId && (
            <Field
              label="Permissions"
              hint={
                channel.permissionMode === 'ask'
                  ? 'Approvals cannot be answered from a channel, so they are denied.'
                  : PERMISSION_HINTS[channel.permissionMode]
              }
            >
              {(id) => (
                <PermissionControl
                  id={id}
                  value={channel.permissionMode}
                  onChange={(permissionMode) => void configure({ permissionMode })}
                />
              )}
            </Field>
          )}
        </Step>
        <Step number={3} title="Turn it on">
          <Switch
            label={`Enable ${CHANNEL_LABELS[channel.kind]}`}
            hint={channel.error ?? CHANNEL_STATE_LABELS[channel.state]}
            checked={channel.enabled}
            onChange={(enabled) => void configure({ enabled })}
          />
        </Step>
        <Step number={4} title="Pair yourself">
          <Pairing kind={channel.kind} />
        </Step>
      </div>
    </Dialog>
  )
}

function ChannelCard({ channel }: { channel: Channel }): ReactNode {
  const [open, setOpen] = useState(false)
  const guide = GUIDES[channel.kind]
  const Icon = guide.icon
  const { projects } = useApp()
  const project = projects.find(({ id }) => id === channel.projectId)

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
        <p className="muted">{guide.description}</p>
      </div>
      {channel.error && <Banner tone="error">{channel.error}</Banner>}
      <p className="hint channel-card-where">
        {channel.enabled ? `Works in ${project?.name ?? 'plain conversation'}` : 'Not set up yet'}
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
