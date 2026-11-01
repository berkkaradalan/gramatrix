import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const REPOSITORY = join(__dirname, '..')

// Stand-ins for the build tools and macOS commands, so the whole script runs on any machine.
const FAKE_COMMANDS: Record<string, string> = {
  uname: 'echo "${FAKE_OS:-Darwin}"',
  sysctl: 'echo "${FAKE_ARM64:-1}"',
  node: 'echo "${FAKE_NODE_MAJOR:-22}"',
  npm: '[ -z "${FAKE_BUILD_FAILS:-}" ] || { echo "the compiler said no"; exit 1; }',
  npx: `
    mkdir -p dist
    case "$2" in
      --mac) echo "built for $3" > "dist/Gramatrix-mac-\${3#--}.zip" ;;
      --linux) echo 'built deb' > dist/gramatrix-linux-amd64.deb ;;
    esac`,
  ditto: 'mkdir -p "$4/Gramatrix.app/Contents" && cp "$3" "$4/Gramatrix.app/Contents/marker"',
  codesign: 'exit 0',
  pgrep: 'exit 1',
  open: 'exit 0',
  osascript: 'exit 0',
  id: 'echo 1000',
  dpkg: 'echo amd64',
  sudo: '"$@"',
  'apt-get': 'cp "$3" "$FAKE_LOG.installed"',
  setsid: 'exit 0'
}

describe('install.sh in the repository root', () => {
  let root: string
  let bin: string
  let repository: string
  let apps: string
  let log: string

  function install(env: Record<string, string> = {}): { status: number | null; output: string } {
    const result = spawnSync('bash', [join(repository, 'install.sh')], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: root,
        FAKE_LOG: log,
        GRAMATRIX_INSTALL_DIR: apps,
        ...env
      }
    })
    return { status: result.status, output: result.stdout + result.stderr }
  }

  const calls = (): string => (existsSync(log) ? readFileSync(log, 'utf8') : '')

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gramatrix-repo-install-'))
    bin = join(root, 'bin')
    repository = join(root, 'repository')
    apps = join(root, 'Applications')
    log = join(root, 'calls.log')
    for (const dir of [bin, apps, join(repository, 'website/public')]) {
      mkdirSync(dir, { recursive: true })
    }
    cpSync(join(REPOSITORY, 'install.sh'), join(repository, 'install.sh'))
    cpSync(
      join(REPOSITORY, 'website/public/install.sh'),
      join(repository, 'website/public/install.sh')
    )
    for (const [name, body] of Object.entries(FAKE_COMMANDS)) {
      const path = join(bin, name)
      writeFileSync(path, `#!/bin/bash\necho "${name} $*" >> "${log}"\n${body}\n`)
      chmodSync(path, 0o755)
    }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('builds the repository, installs the app and opens it with one command', () => {
    const { status, output } = install()

    expect(status).toBe(0)
    expect(calls()).toContain('npm ci')
    expect(calls()).toContain('npm run build')
    expect(calls()).toContain('npx electron-builder --mac --arm64 --publish never')
    expect(readFileSync(join(apps, 'Gramatrix.app/Contents/marker'), 'utf8')).toContain('--arm64')
    expect(calls()).toContain(`open ${join(apps, 'Gramatrix.app')}`)
    expect(output).toContain('Launchpad, Spotlight or your Dock')
  })

  it('builds for Intel on an Intel Mac', () => {
    expect(install({ FAKE_ARM64: '0' }).status).toBe(0)
    expect(calls()).toContain('npx electron-builder --mac --x64 --publish never')
  })

  it('needs no release, because nothing is downloaded', () => {
    expect(install().status).toBe(0)
    expect(calls()).not.toContain('curl')
  })

  it('builds the .deb on Linux and installs it with apt', () => {
    const { status, output } = install({ FAKE_OS: 'Linux' })

    expect(status).toBe(0)
    expect(calls()).toContain('npx electron-builder --linux deb --x64 --publish never')
    expect(readFileSync(`${log}.installed`, 'utf8')).toContain('built deb')
    expect(output).toContain('applications menu')
  })

  it('stops before building on a Linux without apt', () => {
    rmSync(join(bin, 'apt-get'))

    const result = spawnSync('/bin/bash', [join(repository, 'install.sh')], {
      encoding: 'utf8',
      env: { PATH: bin, FAKE_OS: 'Linux' }
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Debian, Ubuntu and systems based on them')
    expect(calls()).not.toContain('npm')
  })

  it('refuses to run on a system it does not support', () => {
    const { status, output } = install({ FAKE_OS: 'FreeBSD' })

    expect(status).toBe(1)
    expect(output).toContain('Gramatrix runs on macOS, Debian and Ubuntu')
    expect(calls()).not.toContain('npm')
  })

  it('says where to get Node.js when the installed one is too old', () => {
    const { status, output } = install({ FAKE_NODE_MAJOR: '20' })

    expect(status).toBe(1)
    expect(output).toContain('Node.js 22 or newer')
    expect(output).toContain('https://nodejs.org')
    expect(calls()).not.toContain('npm')
  })

  it('shows why a failed build failed and installs nothing', () => {
    const { status, output } = install({ FAKE_BUILD_FAILS: '1' })

    expect(status).toBe(1)
    expect(output).toContain('the compiler said no')
    expect(existsSync(join(apps, 'Gramatrix.app'))).toBe(false)
  })
})
