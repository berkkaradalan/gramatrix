import type { HostEventName } from '@shared/rpc'
import type { HostContext } from './context'
import { createHost, type Host } from './create-host'
import { openDatabase } from './db/database'

export interface RecordedEvent {
  event: HostEventName
  payload: unknown
}

export interface TestHost {
  host: Host
  context: HostContext
  events: RecordedEvent[]
  secrets: Map<string, string>
  clock: { advance(milliseconds: number): void }
}

/** Builds a host on an in-memory database with a controllable clock. */
export function createTestHost(): TestHost {
  const events: RecordedEvent[] = []
  const secrets = new Map<string, string>()
  let time = 1_000_000
  const context: HostContext = {
    db: openDatabase(':memory:'),
    now: () => time,
    getSecret: async (name) => secrets.get(name) ?? null,
    emit: (event, payload) => events.push({ event, payload })
  }
  return {
    host: createHost(context),
    context,
    events,
    secrets,
    clock: {
      advance: (milliseconds) => {
        time += milliseconds
      }
    }
  }
}
