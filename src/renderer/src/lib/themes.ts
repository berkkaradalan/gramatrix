import type { ThemeId } from '@shared/types'
import { mix, withAlpha } from './colors'

/**
 * Colors taken from each theme's official palette. Everything else, such as hover states and
 * borders, is derived in `themeTokens`, so a theme entry stays easy to compare with its source.
 */
export interface ThemeDefinition {
  id: ThemeId
  label: string
  mode: 'dark' | 'light'
  /** Name of the Shiki theme used for code when the code theme is Auto. */
  shikiTheme: string
  /** The window and editor background. */
  bg: string
  /** Sidebar, composer and cards. */
  surface: string
  /** Menus, dialogs and popovers. */
  popover: string
  /** Selected rows and the strongest raised surface. */
  raised: string
  text: string
  /** Secondary text. */
  muted: string
  /** Decorative text and placeholders. */
  faint: string
  accent: string
  /** Text on top of the accent. */
  onAccent: string
  warning: string
  success: string
  danger: string
}

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: 'matrix',
    label: 'Matrix',
    mode: 'dark',
    shikiTheme: 'matrix',
    bg: '#000000',
    surface: '#0b0b0b',
    popover: '#101010',
    raised: '#1b1b1b',
    text: '#ededed',
    muted: '#a0a0a0',
    faint: '#6a6a6a',
    accent: '#00e63a',
    onAccent: '#000000',
    warning: '#e6b84d',
    success: '#00e63a',
    danger: '#ff6b5e'
  },
  {
    id: 'dracula',
    label: 'Dracula',
    mode: 'dark',
    shikiTheme: 'dracula',
    bg: '#282a36',
    surface: '#21222c',
    popover: '#21222c',
    raised: '#44475a',
    text: '#f8f8f2',
    muted: '#c0c3d4',
    faint: '#6272a4',
    accent: '#bd93f9',
    onAccent: '#21222c',
    warning: '#ffb86c',
    success: '#50fa7b',
    danger: '#ff5555'
  },
  {
    id: 'vscode-dark',
    label: 'VS Code Dark',
    mode: 'dark',
    shikiTheme: 'dark-plus',
    bg: '#1e1e1e',
    surface: '#252526',
    popover: '#252526',
    raised: '#37373d',
    text: '#d4d4d4',
    muted: '#a6a6a6',
    faint: '#6e7681',
    accent: '#3794ff',
    onAccent: '#000000',
    warning: '#cca700',
    success: '#89d185',
    danger: '#f14c4c'
  },
  {
    id: 'vscode-light',
    label: 'VS Code Light',
    mode: 'light',
    shikiTheme: 'light-plus',
    bg: '#ffffff',
    surface: '#f3f3f3',
    popover: '#ffffff',
    raised: '#e4e6f1',
    text: '#333333',
    muted: '#616161',
    faint: '#8a8a8a',
    accent: '#005fb8',
    onAccent: '#ffffff',
    warning: '#895503',
    success: '#388a34',
    danger: '#cd3131'
  },
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    mode: 'dark',
    shikiTheme: 'catppuccin-mocha',
    bg: '#1e1e2e',
    surface: '#181825',
    popover: '#181825',
    raised: '#313244',
    text: '#cdd6f4',
    muted: '#a6adc8',
    faint: '#6c7086',
    accent: '#cba6f7',
    onAccent: '#11111b',
    warning: '#f9e2af',
    success: '#a6e3a1',
    danger: '#f38ba8'
  },
  {
    id: 'catppuccin-macchiato',
    label: 'Catppuccin Macchiato',
    mode: 'dark',
    shikiTheme: 'catppuccin-macchiato',
    bg: '#24273a',
    surface: '#1e2030',
    popover: '#1e2030',
    raised: '#363a4f',
    text: '#cad3f5',
    muted: '#b8c0e0',
    faint: '#6e738d',
    accent: '#c6a0f6',
    onAccent: '#181926',
    warning: '#eed49f',
    success: '#a6da95',
    danger: '#ed8796'
  },
  {
    id: 'catppuccin-frappe',
    label: 'Catppuccin Frappe',
    mode: 'dark',
    shikiTheme: 'catppuccin-frappe',
    bg: '#303446',
    surface: '#292c3c',
    popover: '#292c3c',
    raised: '#414559',
    text: '#c6d0f5',
    muted: '#b5bfe2',
    faint: '#737994',
    accent: '#ca9ee6',
    onAccent: '#232634',
    warning: '#e5c890',
    success: '#a6d189',
    danger: '#e78284'
  },
  {
    id: 'catppuccin-latte',
    label: 'Catppuccin Latte',
    mode: 'light',
    shikiTheme: 'catppuccin-latte',
    bg: '#eff1f5',
    surface: '#e6e9ef',
    popover: '#eff1f5',
    raised: '#ccd0da',
    text: '#4c4f69',
    muted: '#5c5f77',
    faint: '#8c8fa1',
    accent: '#8839ef',
    onAccent: '#ffffff',
    warning: '#8a5a12',
    success: '#179299',
    danger: '#d20f39'
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    mode: 'dark',
    shikiTheme: 'tokyo-night',
    bg: '#1a1b26',
    surface: '#16161e',
    popover: '#16161e',
    raised: '#292e42',
    text: '#c0caf5',
    muted: '#a9b1d6',
    faint: '#565f89',
    accent: '#7aa2f7',
    onAccent: '#16161e',
    warning: '#e0af68',
    success: '#9ece6a',
    danger: '#f7768e'
  },
  {
    id: 'nord',
    label: 'Nord',
    mode: 'dark',
    shikiTheme: 'nord',
    bg: '#2e3440',
    surface: '#3b4252',
    popover: '#3b4252',
    raised: '#434c5e',
    text: '#eceff4',
    muted: '#d8dee9',
    faint: '#7b88a1',
    accent: '#88c0d0',
    onAccent: '#2e3440',
    warning: '#ebcb8b',
    success: '#a3be8c',
    danger: '#d08770'
  },
  {
    id: 'one-dark',
    label: 'One Dark',
    mode: 'dark',
    shikiTheme: 'one-dark-pro',
    bg: '#282c34',
    surface: '#21252b',
    popover: '#21252b',
    raised: '#3e4451',
    text: '#c8ccd4',
    muted: '#abb2bf',
    faint: '#5c6370',
    accent: '#61afef',
    onAccent: '#21252b',
    warning: '#e5c07b',
    success: '#98c379',
    danger: '#e06c75'
  },
  {
    id: 'github-dark',
    label: 'GitHub Dark',
    mode: 'dark',
    shikiTheme: 'github-dark',
    bg: '#0d1117',
    surface: '#161b22',
    popover: '#161b22',
    raised: '#21262d',
    text: '#e6edf3',
    muted: '#9198a1',
    faint: '#6e7681',
    accent: '#58a6ff',
    onAccent: '#0d1117',
    warning: '#d29922',
    success: '#3fb950',
    danger: '#f85149'
  },
  {
    id: 'github-light',
    label: 'GitHub Light',
    mode: 'light',
    shikiTheme: 'github-light',
    bg: '#ffffff',
    surface: '#f6f8fa',
    popover: '#ffffff',
    raised: '#eaeef2',
    text: '#1f2328',
    muted: '#59636e',
    faint: '#818b98',
    accent: '#0969da',
    onAccent: '#ffffff',
    warning: '#9a6700',
    success: '#1a7f37',
    danger: '#d1242f'
  },
  {
    id: 'gruvbox-dark',
    label: 'Gruvbox Dark',
    mode: 'dark',
    shikiTheme: 'gruvbox-dark-medium',
    bg: '#282828',
    surface: '#1d2021',
    popover: '#1d2021',
    raised: '#3c3836',
    text: '#ebdbb2',
    muted: '#bdae93',
    faint: '#928374',
    accent: '#fabd2f',
    onAccent: '#282828',
    warning: '#fe8019',
    success: '#b8bb26',
    danger: '#fb4934'
  },
  {
    id: 'gruvbox-light',
    label: 'Gruvbox Light',
    mode: 'light',
    shikiTheme: 'gruvbox-light-medium',
    bg: '#fbf1c7',
    surface: '#f2e5bc',
    popover: '#fbf1c7',
    raised: '#ebdbb2',
    text: '#3c3836',
    muted: '#504945',
    faint: '#7c6f64',
    accent: '#076678',
    onAccent: '#fbf1c7',
    warning: '#8a5a12',
    success: '#79740e',
    danger: '#9d0006'
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    mode: 'dark',
    shikiTheme: 'solarized-dark',
    bg: '#002b36',
    surface: '#073642',
    popover: '#073642',
    raised: '#0d4553',
    text: '#eee8d5',
    muted: '#93a1a1',
    faint: '#657b83',
    accent: '#2aa198',
    onAccent: '#00212b',
    warning: '#b58900',
    success: '#859900',
    danger: '#dc322f'
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    mode: 'light',
    shikiTheme: 'solarized-light',
    bg: '#fdf6e3',
    surface: '#eee8d5',
    popover: '#fdf6e3',
    raised: '#e3dcc7',
    text: '#073642',
    muted: '#4b5f66',
    faint: '#839496',
    accent: '#1f6fa8',
    onAccent: '#fdf6e3',
    warning: '#7d5f00',
    success: '#6c7d00',
    danger: '#b3261e'
  },
  {
    id: 'rose-pine',
    label: 'Rose Pine',
    mode: 'dark',
    shikiTheme: 'rose-pine',
    bg: '#191724',
    surface: '#1f1d2e',
    popover: '#1f1d2e',
    raised: '#26233a',
    text: '#e0def4',
    muted: '#a8a4c0',
    faint: '#6e6a86',
    accent: '#c4a7e7',
    onAccent: '#191724',
    warning: '#f6c177',
    success: '#9ccfd8',
    danger: '#eb6f92'
  },
  {
    id: 'monokai',
    label: 'Monokai',
    mode: 'dark',
    shikiTheme: 'monokai',
    bg: '#272822',
    surface: '#1e1f1c',
    popover: '#1e1f1c',
    raised: '#3e3d32',
    text: '#f8f8f2',
    muted: '#c2c2b0',
    faint: '#75715e',
    accent: '#a6e22e',
    onAccent: '#1e1f1c',
    warning: '#fd971f',
    success: '#a6e22e',
    danger: '#f92672'
  },
  {
    id: 'ayu-dark',
    label: 'Ayu Dark',
    mode: 'dark',
    shikiTheme: 'ayu-dark',
    bg: '#0b0e14',
    surface: '#0f131a',
    popover: '#0f131a',
    raised: '#1c2129',
    text: '#bfbdb6',
    muted: '#9a9992',
    faint: '#565b66',
    accent: '#e6b450',
    onAccent: '#0b0e14',
    warning: '#ffb454',
    success: '#aad94c',
    danger: '#f07178'
  },
  {
    id: 'kanagawa',
    label: 'Kanagawa',
    mode: 'dark',
    shikiTheme: 'kanagawa-wave',
    bg: '#1f1f28',
    surface: '#16161d',
    popover: '#16161d',
    raised: '#2a2a37',
    text: '#dcd7ba',
    muted: '#c8c093',
    faint: '#727169',
    accent: '#7e9cd8',
    onAccent: '#16161d',
    warning: '#e6c384',
    success: '#98bb6c',
    danger: '#ff5d62'
  },
  {
    id: 'everforest',
    label: 'Everforest',
    mode: 'dark',
    shikiTheme: 'everforest-dark',
    bg: '#2d353b',
    surface: '#232a2e',
    popover: '#232a2e',
    raised: '#475258',
    text: '#d3c6aa',
    muted: '#c7bc9f',
    faint: '#859289',
    accent: '#a7c080',
    onAccent: '#232a2e',
    warning: '#dbbc7f',
    success: '#a7c080',
    danger: '#e67e80'
  }
]

export const DEFAULT_THEME_ID: ThemeId = 'matrix'

export function themeById(id: string): ThemeDefinition {
  const theme = THEMES.find((candidate) => candidate.id === id)
  if (theme) return theme
  const fallback = THEMES.find((candidate) => candidate.id === DEFAULT_THEME_ID)
  if (!fallback) throw new Error('The default theme is missing.')
  return fallback
}

export function isThemeId(id: string): id is ThemeId {
  return THEMES.some((theme) => theme.id === id)
}

/** How strongly the background is hidden, from 0 to 1. Below 1 the desktop shows through. */
export interface ThemeTokenOptions {
  accent?: { color: string; onColor: string } | undefined
  windowAlpha?: number
}

/** Every color custom property a theme sets. Components only ever read these. */
export function themeTokens(
  theme: ThemeDefinition,
  { accent, windowAlpha = 1 }: ThemeTokenOptions = {}
): Record<string, string> {
  const dark = theme.mode === 'dark'
  const accentColor = accent?.color ?? theme.accent
  const onAccent = accent?.onColor ?? theme.onAccent
  const surfaceHover = mix(theme.surface, theme.raised, 0.55)
  // Alpha applies to surfaces only, so text stays solid over the desktop.
  const see = (hex: string): string => (windowAlpha < 1 ? withAlpha(hex, windowAlpha) : hex)

  return {
    '--bg': see(theme.bg),
    '--bg-solid': theme.bg,
    '--surface': see(theme.surface),
    '--surface-solid': theme.surface,
    '--surface-hover': see(surfaceHover),
    '--surface-active': see(theme.raised),
    '--popover': theme.popover,
    '--border': withAlpha(theme.text, dark ? 0.1 : 0.12),
    '--border-strong': withAlpha(theme.text, dark ? 0.18 : 0.22),
    '--text': theme.text,
    '--muted': theme.muted,
    '--faint': theme.faint,
    '--accent': accentColor,
    '--accent-soft': withAlpha(accentColor, 0.14),
    '--on-accent': onAccent,
    '--warning': theme.warning,
    '--success': theme.success,
    '--success-soft': withAlpha(theme.success, 0.16),
    '--danger': theme.danger,
    '--danger-soft': withAlpha(theme.danger, 0.14),
    '--video-invert': dark ? 'invert(0)' : 'invert(1) hue-rotate(180deg)',
    '--scrim': withAlpha('#000000', dark ? 0.6 : 0.35),
    '--shadow-popover': `0 8px 32px ${withAlpha('#000000', dark ? 0.6 : 0.16)}`
  }
}
