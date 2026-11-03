import { useEffect, useState } from 'react'
import { useApp } from './app-context'

/** Whether the operating system asks apps to reduce motion. Follows the setting live. */
export function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = (): void => setReduced(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

/** True when the app setting or the operating system asks for less motion. */
export function useReducedMotion(): boolean {
  const { settings } = useApp()
  return useSystemReducedMotion() || settings.reduceMotion
}
