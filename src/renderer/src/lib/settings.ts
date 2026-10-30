import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'
import { isThemeId } from './themes'

/**
 * Makes settings from any older version safe to use. Unknown themes become the default, and
 * nested groups are completed, because the host only merges defaults one level deep.
 */
export function normalizeSettings(stored: AppSettings): AppSettings {
  const code = { ...DEFAULT_SETTINGS.code, ...stored.code }
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    theme: isThemeId(stored.theme) ? stored.theme : DEFAULT_SETTINGS.theme,
    code: {
      ...code,
      theme: code.theme === 'auto' || isThemeId(code.theme) ? code.theme : 'auto'
    },
    backgroundVideo: { ...DEFAULT_SETTINGS.backgroundVideo, ...stored.backgroundVideo }
  }
}
