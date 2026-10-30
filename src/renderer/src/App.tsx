import * as RadixTooltip from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import { OverlaysProvider } from './components/OverlaysProvider'
import { Toaster } from './components/Toaster'
import { useApp } from './state/app-context'
import { Onboarding } from './views/Onboarding'
import { Shell } from './views/Shell'

const TOOLTIP_DELAY_MS = 300

export function App(): ReactNode {
  const { settings } = useApp()
  return (
    <RadixTooltip.Provider delayDuration={TOOLTIP_DELAY_MS}>
      <OverlaysProvider>
        {settings.onboardingCompleted ? <Shell /> : <Onboarding />}
        <Toaster />
      </OverlaysProvider>
    </RadixTooltip.Provider>
  )
}
