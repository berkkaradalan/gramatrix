import { useSyncExternalStore } from 'react'
import type { ApprovalRequest, RunEvent } from '@shared/types'
import { IDLE_RUN, applyRunEvent, settleRun, type RunState } from '../lib/run-reducer'

const NOTIFY_INTERVAL_MS = 33

/**
 * Holds live run state per chat, so a run keeps its progress while another chat is open.
 * Listeners are notified at a fixed rate because text deltas can arrive very quickly.
 */
class RunStore {
  private readonly runs = new Map<string, RunState>()
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | null = null

  connect(): () => void {
    return window.gramatrix.on('run.event', (event) => this.apply(event))
  }

  get(chatId: string): RunState {
    return this.runs.get(chatId) ?? IDLE_RUN
  }

  isRunning(chatId: string): boolean {
    return this.get(chatId).status === 'running'
  }

  apply(event: RunEvent): void {
    this.runs.set(event.chatId, applyRunEvent(this.get(event.chatId), event))
    this.scheduleNotify()
  }

  seedApprovals(chatId: string, approvals: ApprovalRequest[]): void {
    this.runs.set(chatId, { ...this.get(chatId), approvals })
    this.scheduleNotify()
  }

  settle(chatId: string): void {
    this.runs.set(chatId, settleRun(this.get(chatId)))
    this.scheduleNotify()
  }

  clearError(chatId: string): void {
    this.runs.set(chatId, { ...this.get(chatId), status: 'idle', error: null })
    this.scheduleNotify()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private scheduleNotify(): void {
    if (this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      for (const listener of this.listeners) listener()
    }, NOTIFY_INTERVAL_MS)
  }
}

export const runStore = new RunStore()

export function useRun(chatId: string): RunState {
  return useSyncExternalStore(runStore.subscribe, () => runStore.get(chatId))
}

export function useIsRunning(chatId: string): boolean {
  return useSyncExternalStore(runStore.subscribe, () => runStore.isRunning(chatId))
}
