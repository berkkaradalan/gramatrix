#!/usr/bin/env node
// Builds the documentation pages from the repository's docs folder, so there is one source of truth.
// Also copies the provider logos from the app. Everything written here is generated and ignored by git.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY = 'https://github.com/berkkaradalan/gramatrix/blob/main'
const websiteRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = join(websiteRoot, '..')
const outputDir = join(websiteRoot, 'src/content/docs/docs')
const logoSource = join(repositoryRoot, 'src/renderer/src/assets/providers')
const logoOutput = join(websiteRoot, 'public/providers')

const sources = [
  ...readdirSync(join(repositoryRoot, 'docs'))
    .filter((file) => file.endsWith('.md'))
    .map((file) => join(repositoryRoot, 'docs', file)),
  join(repositoryRoot, 'CONTRIBUTING.md')
]

function pageSlug(file) {
  return basename(file, '.md').toLowerCase()
}

/** Points links at the matching docs page, or at GitHub for files that have no page. */
function rewriteLinks(markdown) {
  return markdown.replace(/\]\((?!https?:|#|mailto:)([^)]+)\)/g, (_, target) => {
    const [path, hash] = target.split('#')
    const anchor = hash ? `#${hash}` : ''
    const name = basename(path)
    const known = sources.some((source) => basename(source) === name)
    if (known) return `](/docs/${pageSlug(name)}/${anchor})`
    return `](${REPOSITORY}/${path.replace(/^(\.\.\/)+/, '')}${anchor})`
  })
}

/** The first plain paragraph makes a good page description. */
function firstParagraph(body) {
  const paragraph = body.split('\n\n').find((block) => /^[A-Za-z`*]/.test(block.trim()))
  return paragraph ? paragraph.replace(/\s+/g, ' ').replace(/[`*"]/g, '').trim().slice(0, 155) : ''
}

rmSync(outputDir, { recursive: true, force: true })
mkdirSync(outputDir, { recursive: true })
for (const source of sources) {
  const text = readFileSync(source, 'utf8')
  const [, title = pageSlug(source)] = text.match(/^# (.+)$/m) ?? []
  const body = rewriteLinks(text.replace(/^# .+\n+/m, ''))
  const frontmatter = `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(firstParagraph(body))}\n---\n\n`
  writeFileSync(join(outputDir, `${pageSlug(source)}.md`), frontmatter + body)
}

rmSync(logoOutput, { recursive: true, force: true })
mkdirSync(logoOutput, { recursive: true })
for (const file of readdirSync(logoSource))
  copyFileSync(join(logoSource, file), join(logoOutput, file))

console.log(`Synced ${sources.length} docs pages.`)
