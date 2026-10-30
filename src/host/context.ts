import type { HostEventName, HostEvents } from '@shared/rpc'
import type { Database } from './db/database'

/** Everything a service needs from its surroundings. Tests supply fakes for all of it. */
export interface HostContext {
  db: Database
  /** Reads a decrypted secret from the main process. */
  getSecret(name: string): Promise<string | null>
  emit<E extends HostEventName>(event: E, payload: HostEvents[E]): void
  now(): number
}
