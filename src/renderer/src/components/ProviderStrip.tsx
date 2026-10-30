import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp } from '../state/app-context'
import { useOverlays } from '../state/overlays'
import { ProviderLogo } from './ProviderLogo'
import { IconButton, Tooltip } from './ui'

/** Connected providers, always in reach near Settings however long the chat list gets. */
export function ProviderStrip({ collapsed }: { collapsed: boolean }): ReactNode {
  const { providers } = useApp()
  const { openProviders } = useOverlays()
  const connected = providers.filter(({ configured }) => configured)

  return (
    <section className="provider-strip" aria-label="Connected providers">
      {!collapsed && connected.length === 0 && (
        <button type="button" className="provider-strip-empty" onClick={() => openProviders()}>
          No provider connected
        </button>
      )}
      {connected.map((provider) => (
        <Tooltip key={provider.id} label={`${provider.label}: connected`} side="top">
          <button
            type="button"
            className="provider-strip-item"
            aria-label={`${provider.label}, connected`}
            onClick={() => openProviders(provider.id)}
          >
            <ProviderLogo logo={provider.logo} size={14} />
            <span className="provider-strip-dot" aria-hidden="true" />
          </button>
        </Tooltip>
      ))}
      <IconButton
        size="small"
        icon={Plus}
        label="Connect a provider"
        side="top"
        onClick={() => openProviders()}
      />
    </section>
  )
}
