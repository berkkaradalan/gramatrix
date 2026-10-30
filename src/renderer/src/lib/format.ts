const DATE_TIME = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
})

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatDateTime(timestamp: number | null): string {
  return timestamp === null ? 'Never' : DATE_TIME.format(timestamp)
}

/** Compact age for list rows, such as `5m` or `3d`. */
export function formatAge(timestamp: number, now: number = Date.now()): string {
  const age = now - timestamp
  if (age < MINUTE) return 'now'
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`
  if (age < DAY) return `${Math.floor(age / HOUR)}h`
  return `${Math.floor(age / DAY)}d`
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  // Electron wraps errors thrown behind ipcRenderer.invoke with this prefix.
  return message.replace(/^Error invoking remote method 'rpc': (Error: )?/, '')
}

export function formatJson(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2) ?? ''
}
