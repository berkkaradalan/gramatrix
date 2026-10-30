import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'
import { isHexColor, readableOn } from './colors'
import { themeById, themeTokens } from './themes'

/** Pushes appearance settings onto the root element. All styling reads from these. */
export function applyAppearance(settings: AppSettings): void {
  const root = document.documentElement
  const theme = themeById(settings.theme)
  const accent =
    settings.accentColor && isHexColor(settings.accentColor)
      ? { color: settings.accentColor, onColor: readableOn(settings.accentColor) }
      : undefined

  root.dataset['theme'] = theme.id
  root.dataset['mode'] = theme.mode
  root.dataset['motion'] = settings.reduceMotion ? 'reduce' : 'full'
  root.style.colorScheme = theme.mode
  for (const [name, value] of Object.entries(
    themeTokens(theme, { accent, windowAlpha: settings.windowOpacity / 100 })
  )) {
    root.style.setProperty(name, value)
  }
  root.style.setProperty('--font-ui', settings.uiFont.trim() || DEFAULT_SETTINGS.uiFont)
  root.style.setProperty('--font-mono', settings.monoFont.trim() || DEFAULT_SETTINGS.monoFont)
  root.style.setProperty('--font-size', `${settings.fontSize}px`)
  root.style.setProperty('--code-size', `${settings.code.fontSize}px`)
  root.style.setProperty(
    '--code-ligatures',
    settings.code.ligatures ? 'contextual' : 'no-contextual'
  )
}
