import type { ReactNode } from 'react'

export function SettingsGroup({
  title,
  description,
  children
}: {
  title: string
  description?: string
  children: ReactNode
}): ReactNode {
  return (
    <section className="settings-group" aria-label={title}>
      <div>
        <h2>{title}</h2>
        {description && <p className="hint">{description}</p>}
      </div>
      {children}
    </section>
  )
}
