import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ProviderId } from '@shared/types'
import { OverlaysContext, type ConfirmOptions, type Overlays } from '../state/overlays'
import { ProviderDialog } from './providers/ProviderDialog'
import { Button, Dialog } from './ui'

/** Hosts dialogs any screen can open, so each screen does not need its own copy. */
export function OverlaysProvider({ children }: { children: ReactNode }): ReactNode {
  const [providersOpen, setProvidersOpen] = useState(false)
  const [initialProvider, setInitialProvider] = useState<ProviderId | null>(null)
  const [confirmation, setConfirmation] = useState<ConfirmOptions | null>(null)
  const resolveConfirmation = useRef<((confirmed: boolean) => void) | null>(null)

  const settle = (confirmed: boolean): void => {
    resolveConfirmation.current?.(confirmed)
    resolveConfirmation.current = null
    setConfirmation(null)
  }

  const openProviders = useCallback((provider?: ProviderId) => {
    setInitialProvider(provider ?? null)
    setProvidersOpen(true)
  }, [])

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolveConfirmation.current = resolve
        setConfirmation(options)
      }),
    []
  )

  const overlays = useMemo<Overlays>(() => ({ openProviders, confirm }), [openProviders, confirm])

  return (
    <OverlaysContext.Provider value={overlays}>
      {children}
      <ProviderDialog
        open={providersOpen}
        initialProvider={initialProvider}
        onOpenChange={setProvidersOpen}
      />
      <Dialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) settle(false)
        }}
        title={confirmation?.title ?? ''}
        description={confirmation?.body}
      >
        <div className="row row-end">
          <Button variant="ghost" autoFocus onClick={() => settle(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => settle(true)}>
            {confirmation?.action}
          </Button>
        </div>
      </Dialog>
    </OverlaysContext.Provider>
  )
}
