import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import type { AppInfo, AppSettings, Chat, ModelRef, Project, ProviderStatus } from '@shared/types'
import { applyAppearance } from '../lib/appearance'
import { errorMessage } from '../lib/format'
import { pushRecentModel } from '../lib/models'
import { normalizeSettings } from '../lib/settings'
import { invoke, useHostEvent } from './hooks'
import { runStore } from './run-store'

export interface AppState {
  info: AppInfo
  settings: AppSettings
  projects: Project[]
  chats: Chat[]
  chatsLoaded: boolean
  chatsError: string | null
  providers: ProviderStatus[]
  providersLoaded: boolean
  /** Set when the provider list could not load. The rest of the app still works. */
  providersError: string | null
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  rememberModel(model: ModelRef): void
  reloadProjects(): Promise<Project[]>
  reloadProviders(): Promise<ProviderStatus[]>
  reloadChats(): Promise<void>
}

const AppContext = createContext<AppState | null>(null)

export function useApp(): AppState {
  const state = useContext(AppContext)
  if (!state) throw new Error('useApp must be used inside AppProvider.')
  return state
}

/** The model to start with: the saved default when usable, or the first connected provider. */
export function resolveDefaultModel(
  settings: AppSettings,
  providers: ProviderStatus[]
): ModelRef | null {
  const connected = providers.filter((provider) => provider.configured)
  const saved = settings.defaultModel
  if (saved && connected.some((provider) => provider.id === saved.provider)) return saved
  const first = connected[0]
  return first ? { provider: first.id, model: first.defaultModel } : null
}

interface Boot {
  info: AppInfo
}

export function AppProvider({ children }: { children: ReactNode }): ReactNode {
  const [boot, setBoot] = useState<Boot | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [chats, setChats] = useState<Chat[]>([])
  const [chatsLoaded, setChatsLoaded] = useState(false)
  const [chatsError, setChatsError] = useState<string | null>(null)
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [providersLoaded, setProvidersLoaded] = useState(false)
  const [providersError, setProvidersError] = useState<string | null>(null)

  const reloadProviders = useCallback(async () => {
    try {
      const list = await invoke('providers.list', undefined)
      setProviders(list)
      setProvidersError(null)
      return list
    } catch (error) {
      setProvidersError(errorMessage(error))
      return []
    } finally {
      setProvidersLoaded(true)
    }
  }, [])

  const reloadProjects = useCallback(async () => {
    const list = await invoke('projects.list', undefined)
    setProjects(list)
    return list
  }, [])

  const reloadChats = useCallback(async () => {
    try {
      setChats(await invoke('chats.list', undefined))
      setChatsError(null)
    } catch (error) {
      setChatsError(errorMessage(error))
    } finally {
      setChatsLoaded(true)
    }
  }, [])

  const load = useCallback(async () => {
    setBootError(null)
    try {
      const [info, loadedSettings] = await Promise.all([
        invoke('app.info', undefined),
        invoke('settings.get', undefined),
        reloadProjects(),
        reloadProviders(),
        reloadChats()
      ])
      setSettings(normalizeSettings(loadedSettings))
      setBoot({ info })
    } catch (error) {
      setBootError(errorMessage(error))
    }
  }, [reloadChats, reloadProjects, reloadProviders])

  useEffect(() => {
    void load()
    return runStore.connect()
  }, [load])

  useEffect(() => {
    if (settings) applyAppearance(settings)
  }, [settings])

  useHostEvent('settings.changed', (next) => setSettings(normalizeSettings(next)))
  useHostEvent('chats.changed', () => void reloadChats())

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings((current) => (current ? { ...current, ...patch } : current))
    setSettings(normalizeSettings(await invoke('settings.update', patch)))
  }, [])

  const rememberModel = useCallback(
    (model: ModelRef) => {
      const recentModels = pushRecentModel(settings?.recentModels ?? [], model)
      void updateSettings({ recentModels })
    },
    [settings?.recentModels, updateSettings]
  )

  const value = useMemo<AppState | null>(
    () =>
      boot && settings
        ? {
            info: boot.info,
            settings,
            projects,
            chats,
            chatsLoaded,
            chatsError,
            providers,
            providersLoaded,
            providersError,
            updateSettings,
            rememberModel,
            reloadProjects,
            reloadProviders,
            reloadChats
          }
        : null,
    [
      boot,
      settings,
      projects,
      chats,
      chatsLoaded,
      chatsError,
      providers,
      providersLoaded,
      providersError,
      updateSettings,
      rememberModel,
      reloadProjects,
      reloadProviders,
      reloadChats
    ]
  )

  if (bootError) {
    return (
      <main className="boot">
        <p role="alert">Gramatrix could not start: {bootError}</p>
        <button className="button" onClick={() => void load()}>
          Try again
        </button>
      </main>
    )
  }
  if (!value) return <main className="boot" aria-busy="true" />
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
