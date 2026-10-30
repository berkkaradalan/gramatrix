import { ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { PERMISSION_MODES, type PermissionMode } from '@shared/types'
import { PERMISSION_HINTS, PERMISSION_LABELS } from '../lib/labels'
import { Select } from './ui'

const OPTIONS = PERMISSION_MODES.map((mode) => ({
  value: mode,
  label: PERMISSION_LABELS[mode],
  hint: PERMISSION_HINTS[mode]
}))

export function PermissionControl({
  id,
  value,
  onChange,
  compact
}: {
  id?: string
  value: PermissionMode
  onChange(mode: PermissionMode): void
  compact?: boolean
}): ReactNode {
  return (
    <Select
      id={id}
      compact={compact}
      ariaLabel="Permissions"
      value={value}
      options={OPTIONS}
      leading={compact ? <ShieldCheck size={14} aria-hidden /> : undefined}
      onChange={(mode) => onChange(mode as PermissionMode)}
    />
  )
}
