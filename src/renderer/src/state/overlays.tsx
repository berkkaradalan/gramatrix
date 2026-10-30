import { createContext, useContext } from 'react'
import type { ProviderId } from '@shared/types'

export interface ConfirmOptions {
  title: string
  body: string
  action: string
}

export interface Overlays {
  /** Opens the provider dialog on one provider, or on the full list. */
  openProviders(provider?: ProviderId): void
  /** Resolves true when the person confirms the destructive action. */
  confirm(options: ConfirmOptions): Promise<boolean>
}

export const OverlaysContext = createContext<Overlays | null>(null)

export function useOverlays(): Overlays {
  const overlays = useContext(OverlaysContext)
  if (!overlays) throw new Error('useOverlays must be used inside OverlaysProvider.')
  return overlays
}
