import { describe, expect, it } from 'vitest'
import { CHANNEL_COMMANDS, parseCommand } from './commands'

describe('parseCommand', () => {
  it('reads a command and what follows it', () => {
    expect(parseCommand('/model 2')).toEqual({ name: 'model', argument: '2' })
    expect(parseCommand('  /project  my app ')).toEqual({ name: 'project', argument: 'my app' })
    expect(parseCommand('/stop')).toEqual({ name: 'stop', argument: '' })
  })

  it('accepts the bot name Telegram adds in groups, and any letter case', () => {
    expect(parseCommand('/model@gramatrix_bot 2')).toEqual({ name: 'model', argument: '2' })
    expect(parseCommand('/STATUS')).toEqual({ name: 'status', argument: '' })
  })

  it('leaves everything else to the agent', () => {
    expect(parseCommand('/etc/hosts is wrong')).toBeNull()
    expect(parseCommand('/deploy now')).toBeNull()
    expect(parseCommand('please /stop')).toBeNull()
    expect(parseCommand('/pair K7Q2M9AB')).toBeNull()
  })

  it('lists commands Telegram accepts in its menu', () => {
    for (const { name, description } of CHANNEL_COMMANDS) {
      expect(name).toMatch(/^[a-z0-9_]{1,32}$/)
      expect(description.length).toBeLessThanOrEqual(256)
    }
  })
})
