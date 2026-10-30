#!/usr/bin/env node
// Starts electron-vite for local development with an environment that works out of the box.
// Usage: node scripts/electron-vite.mjs <dev|preview> [electron-vite options]
import { spawn, spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

/** True when Chromium has no way to start its sandbox on this Linux system. */
function sandboxIsUnavailable() {
  if (process.platform !== 'linux') return false

  const helper = statSync(join(dirname(require('electron')), 'chrome-sandbox'), {
    throwIfNoEntry: false
  })
  const helperIsInstalled = helper && helper.uid === 0 && (helper.mode & 0o4000) !== 0
  if (helperIsInstalled) return false

  // Ubuntu 24.04 and newer use AppArmor to block user namespaces for unlisted programs.
  const probe = spawnSync('unshare', ['--user', '--map-root-user', 'true'], { stdio: 'ignore' })
  return probe.status !== 0
}

const args = process.argv.slice(2)
if (sandboxIsUnavailable()) {
  console.warn('Chromium sandbox is not available here, so this dev run goes without it.')
  args.push('--noSandbox')
}

// Editors built on Electron export this variable, and it makes Electron behave like plain Node.
const env = { ...process.env }
delete env['ELECTRON_RUN_AS_NODE']

// The package does not export its binary, so it cannot be located with require.resolve.
const electronVite = join(import.meta.dirname, '../node_modules/electron-vite/bin/electron-vite.js')
const child = spawn(process.execPath, [electronVite, ...args], { env, stdio: 'inherit' })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
