import { Check, CircleAlert, Info, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { dismissToast, useToasts } from '../state/toasts'

const ICONS = { success: Check, error: CircleAlert, info: Info }

export function Toaster(): ReactNode {
  const toasts = useToasts()
  return (
    <div className="toaster" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map(({ id, tone, message }) => {
        const Icon = ICONS[tone]
        return (
          <div key={id} className={`toast toast-${tone}`} role="status">
            <Icon size={15} aria-hidden />
            <span className="toast-message">{message}</span>
            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss"
              onClick={() => dismissToast(id)}
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        )
      })}
    </div>
  )
}
