import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { BackgroundVideo } from '../components/BackgroundVideo'
import { useApp } from '../state/app-context'
import { usePersistedState } from '../state/hooks'
import { NavigationContext, type Navigation, type Route } from '../state/navigation'
import { ChannelsView } from './ChannelsView'
import { ChatScreen } from './ChatScreen'
import { CommandPalette } from './CommandPalette'
import { Home } from './Home'
import { ProjectView } from './ProjectView'
import { ScheduledView } from './ScheduledView'
import { SettingsView } from './settings/SettingsView'
import { Sidebar } from './Sidebar'
import { UsageView } from './UsageView'

/** Set by the main process when it replaces the window, to return to the same screen. */
const RESTORE_ROUTE_HASH = '#restore-route'
const ROUTE_KEY = 'shell.route'

function restoredRoute(): Route {
  const home: Route = { view: 'home', projectId: null }
  if (window.location.hash !== RESTORE_ROUTE_HASH) return home
  try {
    return (JSON.parse(localStorage.getItem(ROUTE_KEY) ?? 'null') as Route | null) ?? home
  } catch {
    return home
  }
}

export function Shell(): ReactNode {
  const { chats, projects, settings } = useApp()
  const [route, setRoute] = useState<Route>(restoredRoute)
  const [homeKey, setHomeKey] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [collapsed, setCollapsed] = usePersistedState('sidebar.collapsed', false)
  const [videoFailed, setVideoFailed] = useState(false)

  const newChat = useCallback((projectId: string | null = null) => {
    // A new key clears any half written message, like opening a fresh chat should.
    setHomeKey((key) => key + 1)
    setRoute({ view: 'home', projectId })
  }, [])

  const navigation = useMemo<Navigation>(
    () => ({ route, navigate: setRoute, newChat, openPalette: () => setPaletteOpen(true) }),
    [route, newChat]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key === 'n') newChat(null)
      else if (key === 'k') setPaletteOpen((open) => !open)
      else if (key === 'b') setCollapsed(!collapsed)
      else if (key === ',') setRoute({ view: 'settings', section: 'general' })
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [collapsed, newChat, setCollapsed])

  useEffect(() => {
    try {
      localStorage.setItem(ROUTE_KEY, JSON.stringify(route))
    } catch {
      // Without storage a replaced window simply opens on Home.
    }
  }, [route])

  const chat = route.view === 'chat' ? chats.find(({ id }) => id === route.chatId) : undefined
  const project =
    route.view === 'project' ? projects.find(({ id }) => id === route.projectId) : undefined
  const { backgroundVideo, reduceMotion } = settings
  const showsBackdrop = route.view === 'home' || route.view === 'chat'
  const videoOn = backgroundVideo.enabled && !videoFailed

  return (
    <NavigationContext.Provider value={navigation}>
      <div className={collapsed ? 'shell shell-collapsed' : 'shell'}>
        <Sidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed(!collapsed)} />
        <main className={videoOn && showsBackdrop ? 'main main-video' : 'main'}>
          {/* One instance for Home and chat, so moving between them never restarts the video. */}
          <div className="chat-backdrop" hidden={!videoOn || !showsBackdrop} aria-hidden="true">
            {videoOn && (
              <BackgroundVideo
                settings={backgroundVideo}
                active={showsBackdrop}
                reduceMotion={reduceMotion}
                onError={() => setVideoFailed(true)}
              />
            )}
            <div className="backdrop-dim" />
          </div>
          {route.view === 'home' && <Home key={homeKey} initialProjectId={route.projectId} />}
          {route.view === 'chat' && chat && <ChatScreen key={chat.id} chat={chat} />}
          {route.view === 'chat' && !chat && <Home key={homeKey} initialProjectId={null} />}
          {route.view === 'scheduled' && <ScheduledView />}
          {route.view === 'usage' && <UsageView />}
          {route.view === 'project' && project && <ProjectView project={project} />}
          {route.view === 'project' && !project && <Home key={homeKey} initialProjectId={null} />}
          {route.view === 'channels' && <ChannelsView />}
          {route.view === 'settings' && (
            <SettingsView
              section={route.section}
              onSection={(section) => setRoute({ view: 'settings', section })}
            />
          )}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </NavigationContext.Provider>
  )
}
