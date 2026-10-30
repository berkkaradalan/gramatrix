import { useSyncExternalStore } from 'react'
import type { ModelList, ProviderId } from '@shared/types'
import { errorMessage } from '../lib/format'

export interface ModelEntry {
  list: ModelList | null
  loading: boolean
  error: string | null
}

const EMPTY_ENTRY: ModelEntry = { list: null, loading: false, error: null }

/** Caches model lists per provider. An old list stays visible while a refresh runs. */
class ModelStore {
  private entries: ReadonlyMap<ProviderId, ModelEntry> = new Map()
  private readonly listeners = new Set<() => void>()

  get snapshot(): ReadonlyMap<ProviderId, ModelEntry> {
    return this.entries
  }

  entry(provider: ProviderId): ModelEntry {
    return this.entries.get(provider) ?? EMPTY_ENTRY
  }

  private update(provider: ProviderId, patch: Partial<ModelEntry>): void {
    const next = new Map(this.entries)
    next.set(provider, { ...this.entry(provider), ...patch })
    this.entries = next
    for (const listener of this.listeners) listener()
  }

  async load(provider: ProviderId, refresh = false): Promise<void> {
    const current = this.entry(provider)
    if (current.loading || (current.list && !refresh)) return
    this.update(provider, { loading: true, error: null })
    try {
      const list = await window.gramatrix.invoke('providers.models', { provider, refresh })
      this.update(provider, { list, loading: false })
    } catch (error) {
      this.update(provider, { loading: false, error: errorMessage(error) })
    }
  }

  forget(provider: ProviderId): void {
    const next = new Map(this.entries)
    next.delete(provider)
    this.entries = next
    for (const listener of this.listeners) listener()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export const modelStore = new ModelStore()

export function useModelEntries(): ReadonlyMap<ProviderId, ModelEntry> {
  return useSyncExternalStore(modelStore.subscribe, () => modelStore.snapshot)
}
