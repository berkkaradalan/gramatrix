import { ArrowLeft, ChevronRight, ExternalLink, Eye, EyeOff, Unplug } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { secretName, type ProviderTestResult } from '@shared/rpc'
import type { ProviderId, ProviderStatus } from '@shared/types'
import { ProviderLogo } from '../ProviderLogo'
import { Badge, Banner, Button, CopyButton, Dialog, Field, IconButton } from '../ui'
import { useApp } from '../../state/app-context'
import { invoke, useAction } from '../../state/hooks'
import { modelStore } from '../../state/model-store'
import { useOverlays } from '../../state/overlays'
import { toast } from '../../state/toasts'
import { SecretWarning } from '../SecretWarning'
import { ProviderGrid } from './ProviderGrid'

type VerifyResult =
  { ok: true } | { ok: false; error: string; details: ProviderTestResult['details'] }

function FailureDetails({
  details
}: {
  details: NonNullable<ProviderTestResult['details']>
}): ReactNode {
  const text = Object.entries(details)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join('\n')
  return (
    <details className="failure-details">
      <summary>
        <ChevronRight className="failure-chevron" size={13} aria-hidden />
        Details
      </summary>
      <div className="failure-body">
        <pre>{text}</pre>
        <CopyButton text={text} label="Copy details" />
      </div>
    </details>
  )
}

function ProviderDetail({
  provider,
  onBack,
  onDone
}: {
  provider: ProviderStatus
  onBack?(): void
  onDone(): void
}): ReactNode {
  const { reloadProviders } = useApp()
  const { confirm } = useOverlays()
  const [key, setKey] = useState('')
  const [visible, setVisible] = useState(false)
  const [result, setResult] = useState<VerifyResult | null>(null)
  const { busy, run } = useAction()
  const [opencodeHasKey, setOpencodeHasKey] = useState(false)
  const name = secretName.provider(provider.id)

  useEffect(() => {
    void invoke('opencode.hasKey', { provider: provider.id }).then(setOpencodeHasKey)
  }, [provider.id])

  const store = async (value: string): Promise<void> => {
    await invoke('secrets.set', { name, value })
    setKey('')
    setResult({ ok: true })
    toast.success(`${provider.label} connected.`)
  }

  // The key is tried before it is stored, so a bad key can never replace a working one.
  const save = (): Promise<unknown> =>
    run(async () => {
      setResult(null)
      const value = key.trim()
      const check = await invoke('providers.test', { provider: provider.id, key: value })
      if (check.ok) {
        await store(value)
      } else {
        setResult({
          ok: false,
          error: check.error ?? 'The provider rejected the key.',
          details: check.details
        })
      }
      modelStore.forget(provider.id)
      await reloadProviders()
    })

  const importFromOpencode = (): Promise<unknown> =>
    run(async () => {
      setResult(null)
      const check = await invoke('opencode.importKey', { provider: provider.id })
      if (check.ok) {
        setKey('')
        setResult({ ok: true })
        toast.success(`${provider.label} connected.`)
      } else {
        setResult({
          ok: false,
          error: check.error ?? 'The provider rejected the key.',
          details: check.details
        })
      }
      modelStore.forget(provider.id)
      await reloadProviders()
    })

  const saveAnyway = (): Promise<unknown> =>
    run(async () => {
      await store(key.trim())
      modelStore.forget(provider.id)
      await reloadProviders()
    })

  const disconnect = async (): Promise<void> => {
    const confirmed = await confirm({
      title: `Disconnect ${provider.label}?`,
      body: 'The saved key is deleted from this computer. Chats that use this provider stop working until you connect it again.',
      action: 'Disconnect'
    })
    if (!confirmed) return
    await run(async () => {
      await invoke('secrets.delete', { name })
      modelStore.forget(provider.id)
      await reloadProviders()
      toast.success(`${provider.label} disconnected.`)
      onDone()
    })
  }

  return (
    <div className="stack">
      {onBack && (
        <button type="button" className="link-quiet back-link" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden /> All providers
        </button>
      )}
      <SecretWarning />

      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault()
          if (key.trim() && !busy) void save()
        }}
      >
        <Field
          label={provider.configured ? 'Replace API key' : 'API key'}
          hint={
            <button
              type="button"
              className="link"
              onClick={() => void invoke('app.openExternal', { url: provider.keyUrl })}
            >
              Create a key <ExternalLink size={12} aria-hidden />
            </button>
          }
        >
          {(id) => (
            <div className="input-with-action">
              <input
                id={id}
                className="input input-mono"
                type={visible ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                autoFocus
                placeholder={provider.configured ? 'Saved. Paste a new key to replace it.' : ''}
                value={key}
                onChange={(event) => {
                  setKey(event.target.value)
                  setResult(null)
                }}
              />
              <IconButton
                size="small"
                icon={visible ? EyeOff : Eye}
                label={visible ? 'Hide key' : 'Show key'}
                onClick={() => setVisible(!visible)}
              />
            </div>
          )}
        </Field>

        {opencodeHasKey && !result?.ok && (
          <Button variant="ghost" disabled={busy} onClick={() => void importFromOpencode()}>
            Use my opencode key
          </Button>
        )}

        {result?.ok && <Banner tone="success">Key verified. {provider.label} is ready.</Banner>}
        {result && !result.ok && (
          <>
            <Banner tone="error">
              {result.error}{' '}
              {provider.configured ? 'Your current key is unchanged.' : 'The key was not saved.'}
            </Banner>
            {result.details && <FailureDetails details={result.details} />}
          </>
        )}

        <div className="row">
          {provider.configured && (
            <Button variant="ghost" icon={Unplug} disabled={busy} onClick={() => void disconnect()}>
              Disconnect
            </Button>
          )}
          <span className="spacer" />
          {result && !result.ok && key.trim() && (
            <Button variant="ghost" disabled={busy} onClick={() => void saveAnyway()}>
              Save anyway
            </Button>
          )}
          {result?.ok || (provider.configured && !key) ? (
            <Button variant="primary" onClick={onDone}>
              Done
            </Button>
          ) : (
            <Button type="submit" variant="primary" disabled={busy || !key.trim()}>
              {busy ? 'Verifying' : 'Save and verify'}
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}

function ProviderTitle({ provider }: { provider: ProviderStatus }): ReactNode {
  return (
    <span className="provider-title">
      <ProviderLogo logo={provider.logo} size={18} />
      {provider.label}
      {provider.configured && <Badge tone="accent">Connected</Badge>}
    </span>
  )
}

/** The shared connect experience. Starts on a provider, or on the grid when none is given. */
export function ProviderDialog({
  open,
  initialProvider,
  onOpenChange
}: {
  open: boolean
  initialProvider: ProviderId | null
  onOpenChange(open: boolean): void
}): ReactNode {
  const { providers } = useApp()
  const [selected, setSelected] = useState<ProviderId | null>(initialProvider)

  useEffect(() => {
    if (open) setSelected(initialProvider)
  }, [open, initialProvider])

  const provider = providers.find(({ id }) => id === selected)

  return (
    <Dialog
      wide={!provider}
      open={open}
      onOpenChange={onOpenChange}
      title={provider ? <ProviderTitle provider={provider} /> : 'Connect a provider'}
      description={
        provider?.hint ?? 'Keys are encrypted by your system keychain and stay on this computer.'
      }
    >
      {provider ? (
        <ProviderDetail
          key={provider.id}
          provider={provider}
          onBack={initialProvider ? undefined : () => setSelected(null)}
          onDone={() => onOpenChange(false)}
        />
      ) : (
        <ProviderGrid onOpen={setSelected} />
      )}
    </Dialog>
  )
}
