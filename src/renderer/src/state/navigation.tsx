import { createContext, useContext } from 'react'

export type SettingsSection = 'general' | 'providers' | 'models' | 'appearance' | 'about'

export type Route =
  | { view: 'home'; projectId: string | null }
  | { view: 'chat'; chatId: string }
  | { view: 'scheduled' }
  | { view: 'usage' }
  | { view: 'project'; projectId: string }
  | { view: 'channels' }
  | { view: 'settings'; section: SettingsSection }

export interface Navigation {
  route: Route
  navigate(route: Route): void
  /** Opens Home with the composer ready, in a project when one is given. */
  newChat(projectId?: string | null): void
  openPalette(): void
}

export const NavigationContext = createContext<Navigation | null>(null)

export function useNavigation(): Navigation {
  const navigation = useContext(NavigationContext)
  if (!navigation) throw new Error('useNavigation must be used inside the shell.')
  return navigation
}
