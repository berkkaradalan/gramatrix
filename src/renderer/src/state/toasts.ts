import { useSyncExternalStore } from 'react'

export interface Toast {
  id: number
  tone: 'success' | 'error' | 'info'
  message: string
}

const DISMISS_AFTER_MS = 4000
const ERROR_DISMISS_AFTER_MS = 7000

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()

function publish(next: Toast[]): void {
  toasts = next
  for (const listener of listeners) listener()
}

export function dismissToast(id: number): void {
  publish(toasts.filter((item) => item.id !== id))
}

function show(tone: Toast['tone'], message: string): void {
  const id = nextId++
  publish([...toasts, { id, tone, message }])
  setTimeout(() => dismissToast(id), tone === 'error' ? ERROR_DISMISS_AFTER_MS : DISMISS_AFTER_MS)
}

export const toast = {
  success: (message: string) => show('success', message),
  error: (message: string) => show('error', message),
  info: (message: string) => show('info', message)
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => toasts
  )
}
