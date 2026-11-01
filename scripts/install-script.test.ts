import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
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

const SCRIPT = join(__dirname, '../website/public/install.sh')
const RELEASE_ZIP = 'contents of the release zip'

// The script only talks to the system through these commands, so each test swaps them for small
// stand-ins. The stand-ins log their arguments, which lets a test see what the script asked for.
const FAKE_COMMANDS: Record<string, string> = {
  uname: 'echo "${FAKE_OS:-Darwin}"',
  sysctl: 'echo "${FAKE_ARM64:-1}"',
  curl: `
    while [ $# -gt 0 ]; do
      case "$1" in
        --output) output=$2; shift 2 ;;
        http*) url=$1; shift ;;
        *) shift ;;
      esac
    done
    [ -z "\${FAKE_DOWNLOAD_FAILS:-}" ] || exit 22
    case "$url" in
      */SHA256SUMS) cp "$FAKE_RELEASE/SHA256SUMS" "$output" ;;
      *) [ -f "$FAKE_RELEASE/$(basename "$url")" ] || exit 22
         cp "$FAKE_RELEASE/$(basename "$url")" "$output" ;;
    esac`,
  ditto: `
    [ -z "\${FAKE_ZIP_EMPTY:-}" ] || { mkdir -p "$4"; exit 0; }
    mkdir -p "$4/Gramatrix.app/Contents"
    cp "$3" "$4/Gramatrix.app/Contents/marker"`,
  codesign: `
    case "$1" in
      --verify) [ -z "\${FAKE_UNSIGNED:-}" ] ;;
      *) [ -z "\${FAKE_SIGN_FAILS:-}" ] ;;
    esac`,
  pgrep: 'exit 1',
  open: 'exit 0',
  osascript: 'exit 0',
  id: 'echo "${FAKE_UID:-1000}"',
  dpkg: 'echo "${FAKE_DEB_ARCH:-amd64}"',
  sudo: '"$@"',
  'apt-get': `
    [ -z "\${FAKE_APT_FAILS:-}" ] || exit 100
    cp "$3" "$FAKE_LOG.installed"`,
  setsid: 'exit 0'
}

describe('install.sh', () => {
  let root: string
  let bin: string
  let release: string
  let apps: string
  let log: string

  function publishRelease(file: string, checksumOf = RELEASE_ZIP): void {
    writeFileSync(join(release, file), RELEASE_ZIP)
    const hash = createHash('sha256').update(checksumOf).digest('hex')
    writeFileSync(join(release, 'SHA256SUMS'), `${hash}  ${file}\n`)
  }

  function install(env: Record<string, string> = {}): { status: number | null; output: string } {
    const result = spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: root,
        FAKE_RELEASE: release,
        FAKE_LOG: log,
        GRAMATRIX_INSTALL_DIR: apps,
        ...env
      }
    })
    return { status: result.status, output: result.stdout + result.stderr }
  }

  const calls = (): string => (existsSync(log) ? readFileSync(log, 'utf8') : '')
  const installedApp = (): string => join(apps, 'Gramatrix.app')

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gramatrix-install-'))
    bin = join(root, 'bin')
    release = join(root, 'release')
    apps = join(root, 'Applications')
    log = join(root, 'calls.log')
    for (const dir of [bin, release, apps]) mkdirSync(dir)
    for (const [name, body] of Object.entries(FAKE_COMMANDS)) {
      const path = join(bin, name)
      writeFileSync(path, `#!/bin/bash\necho "${name} $*" >> "${log}"\n${body}\n`)
      chmodSync(path, 0o755)
    }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('puts the app in Applications, opens it and tells the user no terminal is needed again', () => {
    publishRelease('Gramatrix-mac-arm64.zip')

    const { status, output } = install()

    expect(status).toBe(0)
    expect(readFileSync(join(installedApp(), 'Contents/marker'), 'utf8')).toBe(RELEASE_ZIP)
    expect(calls()).toContain(`open ${installedApp()}`)
    expect(output).toContain('Launchpad, Spotlight or your Dock')
  })

  it('downloads the Intel build on an Intel Mac', () => {
    publishRelease('Gramatrix-mac-x64.zip')

    expect(install({ FAKE_ARM64: '0' }).status).toBe(0)
    expect(calls()).toContain('Gramatrix-mac-x64.zip')
  })

  it('refuses to run on a system it does not support', () => {
    const { status, output } = install({ FAKE_OS: 'FreeBSD' })

    expect(status).toBe(1)
    expect(output).toContain('Gramatrix runs on macOS, Debian and Ubuntu')
    expect(calls()).not.toContain('curl')
  })

  it('keeps the installed app when the checksum does not match', () => {
    publishRelease('Gramatrix-mac-arm64.zip', 'something else')
    mkdirSync(installedApp())

    const { status, output } = install()

    expect(status).toBe(1)
    expect(output).toContain('damaged or incomplete')
    expect(existsSync(installedApp())).toBe(true)
    expect(calls()).not.toContain('ditto')
  })

  it('reports a failed download and leaves nothing behind', () => {
    publishRelease('Gramatrix-mac-arm64.zip')

    const { status, output } = install({ FAKE_DOWNLOAD_FAILS: '1' })

    expect(status).toBe(1)
    expect(output).toContain('download failed')
    expect(spawnSync('ls', ['-A', apps], { encoding: 'utf8' }).stdout).toBe('')
  })

  it('stops when the download has no app inside', () => {
    publishRelease('Gramatrix-mac-arm64.zip')

    const { status, output } = install({ FAKE_ZIP_EMPTY: '1' })

    expect(status).toBe(1)
    expect(output).toContain('does not contain Gramatrix.app')
  })

  it('signs an app whose signature is not valid', () => {
    publishRelease('Gramatrix-mac-arm64.zip')

    expect(install({ FAKE_UNSIGNED: '1' }).status).toBe(0)
    expect(calls()).toContain('codesign --force --deep --sign -')
  })

  it('keeps the installed app when it cannot sign the new one', () => {
    publishRelease('Gramatrix-mac-arm64.zip')
    mkdirSync(installedApp())
    writeFileSync(join(installedApp(), 'old'), '')

    const { status } = install({ FAKE_UNSIGNED: '1', FAKE_SIGN_FAILS: '1' })

    expect(status).toBe(1)
    expect(existsSync(join(installedApp(), 'old'))).toBe(true)
  })

  it('replaces an older version', () => {
    publishRelease('Gramatrix-mac-arm64.zip')
    mkdirSync(installedApp())
    writeFileSync(join(installedApp(), 'old'), '')

    expect(install().status).toBe(0)
    expect(existsSync(join(installedApp(), 'old'))).toBe(false)
    expect(existsSync(join(installedApp(), 'Contents/marker'))).toBe(true)
  })

  it('falls back to the home Applications folder without access to the system one', () => {
    publishRelease('Gramatrix-mac-arm64.zip')

    const { status, output } = install({ GRAMATRIX_INSTALL_DIR: join(root, 'missing') })

    expect(status).toBe(0)
    expect(existsSync(join(root, 'Applications/Gramatrix.app'))).toBe(true)
    expect(output).toContain(`installed in ${join(root, 'Applications')}`)
  })

  it('installs a local build without downloading anything', () => {
    const zip = join(root, 'local.zip')
    writeFileSync(zip, 'a local build')

    expect(install({ GRAMATRIX_PACKAGE: zip }).status).toBe(0)
    expect(readFileSync(join(installedApp(), 'Contents/marker'), 'utf8')).toBe('a local build')
    expect(calls()).not.toContain('curl')
  })

  describe('on Linux', () => {
    const LINUX = { FAKE_OS: 'Linux', DISPLAY: ':0' }
    const installedPackage = (): string => `${log}.installed`

    it('installs the release package with apt and opens the app', () => {
      publishRelease('gramatrix-linux-amd64.deb')

      const { status, output } = install(LINUX)

      expect(status).toBe(0)
      expect(readFileSync(installedPackage(), 'utf8')).toBe(RELEASE_ZIP)
      expect(calls()).toContain('sudo apt-get install -y')
      expect(calls()).toContain('setsid --fork gramatrix')
      expect(output).toContain('applications menu')
    })

    it('does not use sudo for root and does not start the app as root', () => {
      publishRelease('gramatrix-linux-amd64.deb')

      expect(install({ ...LINUX, FAKE_UID: '0' }).status).toBe(0)
      expect(calls()).not.toContain('sudo')
      expect(calls()).not.toContain('setsid')
    })

    it('does not try to open the app without a desktop session', () => {
      publishRelease('gramatrix-linux-amd64.deb')

      expect(install({ FAKE_OS: 'Linux' }).status).toBe(0)
      expect(calls()).not.toContain('setsid')
    })

    it('keeps the system untouched when the checksum does not match', () => {
      publishRelease('gramatrix-linux-amd64.deb', 'something else')

      const { status, output } = install(LINUX)

      expect(status).toBe(1)
      expect(output).toContain('damaged or incomplete')
      expect(calls()).not.toContain('apt-get')
    })

    it('reports when apt fails', () => {
      publishRelease('gramatrix-linux-amd64.deb')

      const { status, output } = install({ ...LINUX, FAKE_APT_FAILS: '1' })

      expect(status).toBe(1)
      expect(output).toContain('apt could not install Gramatrix')
      expect(calls()).not.toContain('setsid')
    })

    it('refuses a Linux without apt', () => {
      rmSync(join(bin, 'apt-get'))

      const result = spawnSync('/bin/bash', [SCRIPT], {
        encoding: 'utf8',
        env: { PATH: bin, FAKE_OS: 'Linux' }
      })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Debian, Ubuntu and systems based on them')
    })

    it('refuses processors it has no build for', () => {
      const { status, output } = install({ ...LINUX, FAKE_DEB_ARCH: 'arm64' })

      expect(status).toBe(1)
      expect(output).toContain('64-bit Intel and AMD')
    })

    it('installs a local build without downloading anything', () => {
      const deb = join(root, 'local.deb')
      writeFileSync(deb, 'a local build')

      expect(install({ ...LINUX, GRAMATRIX_PACKAGE: deb }).status).toBe(0)
      expect(readFileSync(installedPackage(), 'utf8')).toBe('a local build')
      expect(calls()).not.toContain('curl')
    })
  })
})
