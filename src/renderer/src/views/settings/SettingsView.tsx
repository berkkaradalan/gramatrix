import * as Tabs from '@radix-ui/react-tabs'
import {
  CircleCheck,
  CircleAlert,
  Cpu,
  Info,
  Palette,
  Plug,
  SlidersHorizontal,
  Star,
  X,
  type LucideIcon
} from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { ModelPicker, findModel } from '../../components/ModelPicker'
import { PermissionControl } from '../../components/PermissionControl'
import { ProviderLogo } from '../../components/ProviderLogo'
import { ProviderGrid } from '../../components/providers/ProviderGrid'
import { EmptyState, Field, IconButton, PageHeader, Switch } from '../../components/ui'
import { PERMISSION_HINTS } from '../../lib/labels'
import { modelKey, toggleModel } from '../../lib/models'
import { useApp } from '../../state/app-context'
import { SettingsGroup as Group } from './SettingsGroup'
import { modelStore, useModelEntries } from '../../state/model-store'
import type { SettingsSection } from '../../state/navigation'
import { useOverlays } from '../../state/overlays'
import { AppearanceSection } from './AppearanceSection'

const SECTIONS: { id: SettingsSection; label: string; icon: LucideIcon }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'providers', label: 'Providers', icon: Plug },
  { id: 'models', label: 'Models', icon: Cpu },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'about', label: 'About', icon: Info }
]

function KeychainState(): ReactNode {
  const { info } = useApp()
  const protectedKeys = info.secretBackend === 'keychain'
  const Icon = protectedKeys ? CircleCheck : CircleAlert
  const detail = {
    keychain: 'API keys are encrypted by your system keychain. No password prompts while you work.',
    weak: 'No keychain service was found, so keys are not really protected. Install GNOME Keyring or KWallet.',
    unavailable:
      'Secure storage is not available, so keys cannot be saved. Check your system keychain.'
  }[info.secretBackend]
  return (
    <div className={protectedKeys ? 'state-row' : 'state-row state-row-warning'}>
      <Icon size={16} aria-hidden />
      <div>
        <p>{protectedKeys ? 'Protected by your keychain' : 'Keys are not protected'}</p>
        <p className="hint">{detail}</p>
      </div>
    </div>
  )
}

function GeneralSection(): ReactNode {
  const { settings, updateSettings } = useApp()
  return (
    <>
      <Group title="Security">
        <KeychainState />
      </Group>
      <Group title="New chats">
        <Field label="Default permissions" hint={PERMISSION_HINTS[settings.defaultPermissionMode]}>
          {(id) => (
            <PermissionControl
              id={id}
              value={settings.defaultPermissionMode}
              onChange={(defaultPermissionMode) => void updateSettings({ defaultPermissionMode })}
            />
          )}
        </Field>
      </Group>
      <Group title="Background">
        <Switch
          label="Keep running in the tray"
          hint="Scheduled jobs and channels keep working after you close the window."
          checked={settings.closeToTray}
          onChange={(closeToTray) => void updateSettings({ closeToTray })}
        />
      </Group>
    </>
  )
}

function ProvidersSection(): ReactNode {
  const { openProviders } = useOverlays()
  return <ProviderGrid onOpen={openProviders} />
}

function ModelsSection(): ReactNode {
  const { settings, providers, updateSettings } = useApp()
  const entries = useModelEntries()
  const { favoriteModels } = settings

  useEffect(() => {
    for (const { provider } of favoriteModels) void modelStore.load(provider)
  }, [favoriteModels])

  return (
    <>
      <Group title="Default model" description="New chats start with this model.">
        <ModelPicker
          block
          ariaLabel="Default model"
          value={settings.defaultModel}
          onChange={(defaultModel) => void updateSettings({ defaultModel })}
        />
      </Group>
      <Group title="Favorites" description="Favorites stay at the top of the model picker.">
        <ModelPicker
          block
          ariaLabel="Add a favorite"
          placeholder="Add a favorite"
          value={null}
          onChange={(model) =>
            void updateSettings({ favoriteModels: toggleModel(favoriteModels, model) })
          }
        />
        {favoriteModels.length === 0 ? (
          <EmptyState icon={Star} title="No favorites yet">
            Star a model in any model picker to keep it close.
          </EmptyState>
        ) : (
          <ul className="list list-plain">
            {favoriteModels.map((model) => {
              const provider = providers.find(({ id }) => id === model.provider)
              return (
                <li key={modelKey(model)} className="list-row">
                  {provider && <ProviderLogo logo={provider.logo} />}
                  <div className="list-row-main">
                    <p>{findModel(entries, model).name}</p>
                    <p className="hint">{provider?.label ?? model.provider}</p>
                  </div>
                  <IconButton
                    icon={X}
                    size="small"
                    label={`Remove ${model.model} from favorites`}
                    onClick={() =>
                      void updateSettings({ favoriteModels: toggleModel(favoriteModels, model) })
                    }
                  />
                </li>
              )
            })}
          </ul>
        )}
      </Group>
    </>
  )
}

function AboutSection(): ReactNode {
  const { info } = useApp()
  return (
    <Group title="Gramatrix">
      <dl className="about">
        <dt>Version</dt>
        <dd>{info.version}</dd>
        <dt>Platform</dt>
        <dd>{info.platform}</dd>
      </dl>
      <p className="hint">
        Chats, jobs and settings are stored on this computer. Prompts and files the agent reads are
        sent to the provider you choose.
      </p>
    </Group>
  )
}

const PANELS: Record<SettingsSection, () => ReactNode> = {
  general: GeneralSection,
  providers: ProvidersSection,
  models: ModelsSection,
  appearance: AppearanceSection,
  about: AboutSection
}

export function SettingsView({
  section,
  onSection
}: {
  section: SettingsSection
  onSection(section: SettingsSection): void
}): ReactNode {
  const Panel = PANELS[section]
  const current = SECTIONS.find(({ id }) => id === section)
  return (
    <Tabs.Root
      className="settings"
      orientation="vertical"
      value={section}
      onValueChange={(value) => onSection(value as SettingsSection)}
    >
      <div className="settings-layout">
        <div className="settings-nav">
          <p className="settings-title">Settings</p>
          <Tabs.List aria-label="Settings sections">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <Tabs.Trigger key={id} value={id} className="side-item settings-tab">
                <Icon size={15} aria-hidden />
                <span className="side-label">{label}</span>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </div>
        <Tabs.Content value={section} className="settings-panel" tabIndex={-1}>
          <PageHeader title={current?.label ?? ''} />
          <Panel />
        </Tabs.Content>
      </div>
    </Tabs.Root>
  )
}
