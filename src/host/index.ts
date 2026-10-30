import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { HostEventName, HostEvents, HostInbound, HostOutbound } from '@shared/rpc'
import { createHost } from './create-host'
import { openDatabase } from './db/database'

// Entry point of the Electron utility process. Agent runs, schedules and chat
// channels live here so that slow work can never freeze the window.

const port = process.parentPort
const dataDir = process.env['GRAMATRIX_DATA_DIR']
if (!dataDir) throw new Error('GRAMATRIX_DATA_DIR is not set.')
mkdirSync(dataDir, { recursive: true })

const pendingSecrets = new Map<number, (value: string | null) => void>()
let nextSecretRequestId = 1

function send(message: HostOutbound): void {
  port.postMessage(message)
}

const host = createHost({
  db: openDatabase(join(dataDir, 'gramatrix.db')),
  now: () => Date.now(),
  getSecret: (name) =>
    new Promise((resolve) => {
      const id = nextSecretRequestId++
      pendingSecrets.set(id, resolve)
      send({ kind: 'secret-request', id, name })
    }),
  emit: <E extends HostEventName>(event: E, payload: HostEvents[E]) =>
    send({ kind: 'event', event, payload })
})

port.on('message', ({ data }: { data: HostInbound }) => {
  if (data.kind === 'secret-response') {
    pendingSecrets.get(data.id)?.(data.value)
    pendingSecrets.delete(data.id)
    return
  }
  if (data.kind === 'shutdown') {
    void host.stop().finally(() => send({ kind: 'shutdown-complete' }))
    return
  }
  host.router.dispatch(data.method, data.params).then(
    (result) => send({ kind: 'response', id: data.id, ok: true, result }),
    (error: unknown) =>
      send({
        kind: 'response',
        id: data.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
  )
})

send({ kind: 'ready' })
host.start()
