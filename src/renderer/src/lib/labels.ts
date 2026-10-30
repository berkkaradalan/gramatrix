import type { ChannelKind, ChannelState, PermissionMode } from '@shared/types'

export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  'read-only': 'Read only',
  ask: 'Ask first',
  'accept-edits': 'Accept edits',
  'full-access': 'Full access'
}

export const PERMISSION_HINTS: Record<PermissionMode, string> = {
  'read-only': 'Reads files. Cannot change anything.',
  ask: 'Asks before it edits files or runs commands.',
  'accept-edits': 'Edits files directly. Asks before commands.',
  'full-access': 'Edits files and runs commands without asking.'
}

export const CHANNEL_LABELS: Record<ChannelKind, string> = {
  telegram: 'Telegram',
  slack: 'Slack'
}

export const CHANNEL_STATE_LABELS: Record<ChannelState, string> = {
  disabled: 'Off',
  connecting: 'Connecting',
  connected: 'Connected',
  error: 'Needs attention'
}

export interface FontOption {
  label: string
  value: string
}

export const UI_FONT_OPTIONS: FontOption[] = [
  { label: 'Inter', value: "'Inter Variable', system-ui, sans-serif" },
  { label: 'System', value: 'system-ui, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica Neue, Helvetica, Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' }
]

export const MONO_FONT_OPTIONS: FontOption[] = [
  { label: 'JetBrains Mono', value: "'JetBrains Mono Variable', ui-monospace, monospace" },
  { label: 'System', value: 'ui-monospace, Menlo, Consolas, monospace' },
  { label: 'Fira Code', value: 'Fira Code, ui-monospace, monospace' },
  { label: 'IBM Plex Mono', value: 'IBM Plex Mono, ui-monospace, monospace' }
]

/** Quick choices for the accent override, taken from the theme palettes. */
export const ACCENT_PRESETS = [
  { label: 'Matrix', color: '#00e63a' },
  { label: 'Blue', color: '#58a6ff' },
  { label: 'Purple', color: '#bd93f9' },
  { label: 'Pink', color: '#ff79c6' },
  { label: 'Teal', color: '#2aa198' },
  { label: 'Amber', color: '#fabd2f' },
  { label: 'Orange', color: '#fe8019' },
  { label: 'Red', color: '#ff5555' }
]
