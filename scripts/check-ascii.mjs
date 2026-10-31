#!/usr/bin/env node
// Fails when any tracked source or documentation file contains a non-ASCII byte.
// The project requires the repository to be English only, so this runs in `npm run check`.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.webp',
  '.ico',
  '.icns',
  '.jpg',
  '.jpeg',
  '.mp4',
  '.webm',
  '.woff2'
])
const SKIPPED_FILES = new Set(['package-lock.json'])

const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8'
})
const files = listed.split('\n').filter(Boolean)

const violations = []
for (const file of files) {
  if (BINARY_EXTENSIONS.has(extname(file)) || SKIPPED_FILES.has(file)) continue
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  text.split('\n').forEach((line, index) => {
    const column = line.search(/[^\x00-\x7F]/)
    if (column !== -1) violations.push(`${file}:${index + 1}:${column + 1}`)
  })
}

if (violations.length > 0) {
  console.error('Non-ASCII characters found:')
  for (const violation of violations) console.error(`  ${violation}`)
  process.exit(1)
}
console.log(`ASCII check passed for ${files.length} files.`)
