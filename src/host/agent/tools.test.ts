import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CommandRegistry } from './commands'
import { createProjectDirectory } from './testing'
import { BASE_TOOLS, MAX_COMMAND_OUTPUT_BYTES, MAX_READ_BYTES } from './tools'

function runTool(
  name: string,
  input: unknown,
  root: string,
  signal = new AbortController().signal
): Promise<string> {
  const tool = BASE_TOOLS.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`No tool named ${name}`)
  return tool.run(tool.inputSchema.parse(input), { root, signal, commands: new CommandRegistry() })
}

describe('tool risk levels', () => {
  it('marks only file changes as writes and only commands as execution', () => {
    const risks = Object.fromEntries(BASE_TOOLS.map((tool) => [tool.name, tool.risk]))
    expect(risks).toEqual({
      read_file: 'read',
      list_dir: 'read',
      search_files: 'read',
      write_file: 'write',
      edit_file: 'write',
      run_command: 'execute'
    })
  })
})

describe('files that are not regular', () => {
  function createFifo(root: string): void {
    execFileSync('mkfifo', [join(root, 'pipe')])
  }

  it.each([
    ['read_file', { path: 'pipe' }],
    ['write_file', { path: 'pipe', content: 'x' }],
    ['edit_file', { path: 'pipe', oldText: 'a', newText: 'b' }]
  ])('%s refuses a FIFO instead of blocking on it', async (name, input) => {
    const root = createProjectDirectory()
    createFifo(root)
    await expect(runTool(name, input, root)).rejects.toThrow('not a regular file')
  })

  it('search_files skips a FIFO', async () => {
    const root = createProjectDirectory()
    createFifo(root)
    await expect(runTool('search_files', { query: 'x' }, root)).resolves.toBe('No matches.')
  })
})

describe('git metadata', () => {
  it.each(['.git/config', '.GIT/config', 'sub/.Git/hooks/pre-commit', '.git'])(
    'refuses to write %s',
    async (path) => {
      const root = createProjectDirectory()
      await expect(runTool('write_file', { path, content: 'x' }, root)).rejects.toThrow(
        'git metadata'
      )
      expect(existsSync(join(root, path))).toBe(false)
    }
  )

  it('refuses to edit git config, the path to running commands', async () => {
    const root = createProjectDirectory()
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, '.git/config'), '[core]\n')
    await expect(
      runTool(
        'edit_file',
        { path: '.git/config', oldText: '[core]', newText: '[core]\nfsmonitor = evil' },
        root
      )
    ).rejects.toThrow('git metadata')
    expect(readFileSync(join(root, '.git/config'), 'utf8')).toBe('[core]\n')
  })

  it('refuses a link that resolves to git metadata', async () => {
    const root = createProjectDirectory()
    mkdirSync(join(root, '.git'))
    symlinkSync(join(root, '.git'), join(root, 'alias'))
    await expect(
      runTool('write_file', { path: 'alias/config', content: 'x' }, root)
    ).rejects.toThrow('git metadata')
  })

  it('still allows reading it and writing similar names', async () => {
    const root = createProjectDirectory()
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, '.git/config'), 'data')
    await expect(runTool('read_file', { path: '.git/config' }, root)).resolves.toBe('data')
    await runTool('write_file', { path: '.gitignore', content: 'x' }, root)
    await runTool('write_file', { path: 'a.git/b.txt', content: 'x' }, root)
    expect(existsSync(join(root, '.gitignore'))).toBe(true)
  })
})

describe('read_file', () => {
  it('returns content and cuts off large files', async () => {
    const root = createProjectDirectory()
    writeFileSync(join(root, 'small.txt'), 'hello')
    writeFileSync(join(root, 'large.txt'), 'x'.repeat(MAX_READ_BYTES + 10))
    await expect(runTool('read_file', { path: 'small.txt' }, root)).resolves.toBe('hello')
    await expect(runTool('read_file', { path: 'large.txt' }, root)).resolves.toContain('cut off')
  })

  it('refuses binary files and files outside the project', async () => {
    const root = createProjectDirectory()
    writeFileSync(join(root, 'data.bin'), Buffer.from([1, 0, 2]))
    await expect(runTool('read_file', { path: 'data.bin' }, root)).rejects.toThrow('binary')
    await expect(runTool('read_file', { path: '../x' }, root)).rejects.toThrow('outside')
  })
})

describe('list_dir', () => {
  it('marks directories and defaults to the root', async () => {
    const root = createProjectDirectory()
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'a.txt'), '')
    await expect(runTool('list_dir', {}, root)).resolves.toBe('a.txt\nsrc/')
  })
})

describe('search_files', () => {
  it('finds case insensitive matches and skips dependency folders', async () => {
    const root = createProjectDirectory()
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'src/a.ts'), 'one\nNeedle here\n')
    writeFileSync(join(root, 'node_modules/b.js'), 'needle')
    await expect(runTool('search_files', { query: 'needle' }, root)).resolves.toBe(
      'src/a.ts:2: Needle here'
    )
  })

  it('does not follow symlinks out of the project', async () => {
    const root = createProjectDirectory()
    const outside = createProjectDirectory()
    writeFileSync(join(outside, 'secret.txt'), 'needle')
    symlinkSync(outside, join(root, 'link'))
    await expect(runTool('search_files', { query: 'needle' }, root)).resolves.toBe('No matches.')
  })
})

describe('write_file', () => {
  it('creates parent directories', async () => {
    const root = createProjectDirectory()
    await runTool('write_file', { path: 'a/b/c.txt', content: 'hi' }, root)
    expect(readFileSync(join(root, 'a/b/c.txt'), 'utf8')).toBe('hi')
  })

  it('refuses to write outside the project', async () => {
    const root = createProjectDirectory()
    const outside = createProjectDirectory()
    await expect(
      runTool('write_file', { path: join(outside, 'x'), content: 'hi' }, root)
    ).rejects.toThrow('outside')
    expect(existsSync(join(outside, 'x'))).toBe(false)
  })
})

describe('edit_file', () => {
  it('replaces a unique match and keeps dollar signs literal', async () => {
    const root = createProjectDirectory()
    writeFileSync(join(root, 'a.txt'), 'old value')
    await runTool('edit_file', { path: 'a.txt', oldText: 'old', newText: '$& new' }, root)
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('$& new value')
  })

  it('requires replaceAll for repeated matches', async () => {
    const root = createProjectDirectory()
    writeFileSync(join(root, 'a.txt'), 'x x')
    await expect(
      runTool('edit_file', { path: 'a.txt', oldText: 'x', newText: 'y' }, root)
    ).rejects.toThrow('2 times')
    await runTool(
      'edit_file',
      { path: 'a.txt', oldText: 'x', newText: 'y', replaceAll: true },
      root
    )
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('y y')
  })

  it('reports text that is not there', async () => {
    const root = createProjectDirectory()
    writeFileSync(join(root, 'a.txt'), 'x')
    await expect(
      runTool('edit_file', { path: 'a.txt', oldText: 'z', newText: 'y' }, root)
    ).rejects.toThrow('not found')
  })
})

describe('run_command', () => {
  it('runs in the project root and returns output with the exit code', async () => {
    const root = createProjectDirectory()
    const output = await runTool('run_command', { command: 'pwd; echo err >&2; exit 3' }, root)
    expect(output).toContain('[exit code 3]')
    expect(output).toContain(root)
    expect(output).toContain('err')
  })

  it('stops at the timeout', async () => {
    const output = await runTool(
      'run_command',
      { command: 'sleep 30', timeoutMs: 50 },
      createProjectDirectory()
    )
    expect(output).toContain('[timed out]')
  })

  it('caps output', async () => {
    const size = MAX_COMMAND_OUTPUT_BYTES * 2
    const output = await runTool(
      'run_command',
      { command: `head -c ${size} /dev/zero | tr '\\0' a` },
      createProjectDirectory()
    )
    expect(output.length).toBeLessThan(size)
    expect(output).toContain('bytes dropped')
  })

  it('kills the whole process tree on abort', async () => {
    const root = createProjectDirectory()
    const controller = new AbortController()
    const run = runTool(
      'run_command',
      { command: 'sh -c "sleep 0.3; touch survived" & sleep 30' },
      root,
      controller.signal
    )
    setTimeout(() => controller.abort(), 50)
    await expect(run).rejects.toThrow('cancelled')
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(existsSync(join(root, 'survived'))).toBe(false)
  })

  it('does not wait for a background process that keeps the output pipe open', async () => {
    const root = createProjectDirectory()
    const commands = new CommandRegistry()
    const tool = BASE_TOOLS.find(({ name }) => name === 'run_command')
    const started = Date.now()
    const output = await tool?.run(
      { command: 'echo before; sleep 3 &' },
      { root, signal: new AbortController().signal, commands }
    )
    expect(Date.now() - started).toBeLessThan(2000)
    expect(output).toContain('before')
    await commands.killAll(100)
  })

  it('refuses to start after abort', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      runTool('run_command', { command: 'true' }, createProjectDirectory(), controller.signal)
    ).rejects.toThrow()
  })
})
