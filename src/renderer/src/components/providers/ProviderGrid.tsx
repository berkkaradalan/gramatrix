import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ProviderId, ProviderKind, ProviderStatus } from '@shared/types'
import { ProviderLogo } from '../ProviderLogo'
import { Banner, Button, Skeleton } from '../ui'
import { useApp } from '../../state/app-context'

const SECTIONS: { kind: ProviderKind; title: string; description: string }[] = [
  {
    kind: 'api',
    title: 'API keys',
    description: 'Pay per use. You are billed by the provider for every token.'
  },
  {
    kind: 'plan',
    title: 'Coding plans',
    description: 'A monthly subscription. These keys only work on their own plan endpoint.'
  }
]

function ProviderCard({
  provider,
  onOpen
}: {
  provider: ProviderStatus
  onOpen(): void
}): ReactNode {
  return (
    <button
      type="button"
      className={provider.configured ? 'provider-card provider-card-on' : 'provider-card'}
      onClick={onOpen}
    >
      <span className="provider-card-logo">
        <ProviderLogo logo={provider.logo} size={18} />
      </span>
      <span className="provider-card-text">
        <span className="provider-card-name">{provider.label}</span>
        {provider.configured ? (
          <span className="provider-card-state">
            <Check size={12} aria-hidden /> Connected
          </span>
        ) : (
          <span className="provider-card-state provider-card-add">Not connected</span>
        )}
      </span>
    </button>
  )
}

/** The one list of providers, used by onboarding, settings and the provider dialog. */
export function ProviderGrid({ onOpen }: { onOpen(provider: ProviderId): void }): ReactNode {
  const { providers, providersLoaded, providersError, reloadProviders } = useApp()

  if (providersError) {
    return (
      <Banner
        tone="error"
        action={<Button onClick={() => void reloadProviders()}>Try again</Button>}
      >
        Could not load providers: {providersError}
      </Banner>
    )
  }
  if (!providersLoaded) return <Skeleton rows={4} />

  return (
    <div className="provider-sections">
      {SECTIONS.map(({ kind, title, description }) => {
        const list = providers.filter((provider) => provider.kind === kind)
        if (list.length === 0) return null
        return (
          <section key={kind} className="provider-section" aria-label={title}>
            <div>
              <h3>{title}</h3>
              <p className="hint">{description}</p>
            </div>
            <div className="provider-grid">
              {list.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  onOpen={() => onOpen(provider.id)}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
