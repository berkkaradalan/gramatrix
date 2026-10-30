import type { RpcRouter } from '../rpc-router'
import type { HostContext } from '../context'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'

export class SettingsService {
  constructor(private readonly context: HostContext) {}

  get(): AppSettings {
    const rows = this.context.db.prepare('SELECT key, value FROM settings').all() as unknown as {
      key: string
      value: string
    }[]
    const stored = Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)]))
    return { ...DEFAULT_SETTINGS, ...stored }
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const statement = this.context.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    for (const [key, value] of Object.entries(patch)) {
      statement.run(key, JSON.stringify(value))
    }
    const settings = this.get()
    this.context.emit('settings.changed', settings)
    return settings
  }

  register(router: RpcRouter): void {
    router.handle('settings.get', () => this.get())
    router.handle('settings.update', (patch) => this.update(patch))
  }
}
