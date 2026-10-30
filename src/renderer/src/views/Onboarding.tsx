import { useState, type ReactNode } from 'react'
import type { ModelRef } from '@shared/types'
import { LogoMark } from '../components/Logo'
import { ModelPicker } from '../components/ModelPicker'
import { ProviderGrid } from '../components/providers/ProviderGrid'
import { SecretWarning } from '../components/SecretWarning'
import { Button, Field } from '../components/ui'
import { resolveDefaultModel, useApp, type AppState } from '../state/app-context'
import { useOverlays } from '../state/overlays'

type Step = 'welcome' | 'provider' | 'model'

const STEPS: Step[] = ['welcome', 'provider', 'model']

/** Continues where the person left off. Progress is derived from what is already saved. */
function firstOpenStep(app: AppState): Step {
  return app.providers.some(({ configured }) => configured) ? 'model' : 'welcome'
}

function StepDots({ step }: { step: Step }): ReactNode {
  return (
    <div className="step-dots" role="img" aria-label={`Step ${STEPS.indexOf(step) + 1} of 3`}>
      {STEPS.map((candidate) => (
        <span key={candidate} className={candidate === step ? 'step-dot-on' : undefined} />
      ))}
    </div>
  )
}

export function Onboarding(): ReactNode {
  const app = useApp()
  const { openProviders } = useOverlays()
  const [step, setStep] = useState<Step>(() => firstOpenStep(app))
  const [picked, setPicked] = useState<ModelRef | null>(null)
  const connected = app.providers.some(({ configured }) => configured)
  const model = picked ?? resolveDefaultModel(app.settings, app.providers)

  const finish = (): void => {
    void app.updateSettings({
      onboardingCompleted: true,
      ...(model ? { defaultModel: model } : {})
    })
  }

  return (
    <main className="onboarding">
      <div className={step === 'provider' ? 'onboarding-column-wide' : 'onboarding-column'}>
        <div className="onboarding-brand">
          <LogoMark size={24} />
          <span className="brand-name">gramatrix</span>
        </div>

        {step === 'welcome' && (
          <>
            <h1>Your coding agent, on your machine.</h1>
            <p className="muted">
              Bring your own model, point it at a folder, and let it read, edit and run. Your keys
              stay on this computer.
            </p>
            <div className="row">
              <Button variant="primary" onClick={() => setStep('provider')}>
                Get started
              </Button>
              <Button variant="ghost" onClick={finish}>
                Skip setup
              </Button>
            </div>
          </>
        )}

        {step === 'provider' && (
          <>
            <h1>Connect a provider</h1>
            <p className="muted">
              Pick where your models come from. You will not be asked for a password while you work.
            </p>
            <SecretWarning />
            <ProviderGrid onOpen={openProviders} />
            <div className="row">
              <Button variant="primary" disabled={!connected} onClick={() => setStep('model')}>
                Continue
              </Button>
              <Button variant="ghost" onClick={finish}>
                Skip for now
              </Button>
            </div>
          </>
        )}

        {step === 'model' && (
          <>
            <h1>Pick a default model</h1>
            <p className="muted">New chats start with this model. You can change it in any chat.</p>
            <Field label="Default model">
              {(id) => <ModelPicker id={id} block value={model} onChange={setPicked} />}
            </Field>
            <div className="row">
              <Button variant="primary" onClick={finish}>
                Start using Gramatrix
              </Button>
              <Button variant="ghost" onClick={finish}>
                Skip for now
              </Button>
            </div>
          </>
        )}

        <StepDots step={step} />
      </div>
    </main>
  )
}
