import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript'
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import type { Language } from '../lib/languages'
import type { HighlightRequest, HighlightResponse } from './highlight-protocol'
import { MATRIX_CODE_THEME } from './matrix-code-theme'

// Runs off the main thread, so highlighting a large block can never delay typing. Languages and
// themes load on first use. The JavaScript regex engine means the CSP does not need wasm.

const LANGUAGE_LOADERS: Record<Language, () => Promise<{ default: unknown }>> = {
  bash: () => import('@shikijs/langs/bash'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  css: () => import('@shikijs/langs/css'),
  diff: () => import('@shikijs/langs/diff'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  go: () => import('@shikijs/langs/go'),
  html: () => import('@shikijs/langs/html'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  jsx: () => import('@shikijs/langs/jsx'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  markdown: () => import('@shikijs/langs/markdown'),
  php: () => import('@shikijs/langs/php'),
  python: () => import('@shikijs/langs/python'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  sql: () => import('@shikijs/langs/sql'),
  swift: () => import('@shikijs/langs/swift'),
  toml: () => import('@shikijs/langs/toml'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  xml: () => import('@shikijs/langs/xml'),
  yaml: () => import('@shikijs/langs/yaml')
}

const THEME_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  dracula: () => import('@shikijs/themes/dracula'),
  'dark-plus': () => import('@shikijs/themes/dark-plus'),
  'light-plus': () => import('@shikijs/themes/light-plus'),
  'catppuccin-mocha': () => import('@shikijs/themes/catppuccin-mocha'),
  'catppuccin-macchiato': () => import('@shikijs/themes/catppuccin-macchiato'),
  'catppuccin-frappe': () => import('@shikijs/themes/catppuccin-frappe'),
  'catppuccin-latte': () => import('@shikijs/themes/catppuccin-latte'),
  'tokyo-night': () => import('@shikijs/themes/tokyo-night'),
  nord: () => import('@shikijs/themes/nord'),
  'one-dark-pro': () => import('@shikijs/themes/one-dark-pro'),
  'github-dark': () => import('@shikijs/themes/github-dark'),
  'github-light': () => import('@shikijs/themes/github-light'),
  'gruvbox-dark-medium': () => import('@shikijs/themes/gruvbox-dark-medium'),
  'gruvbox-light-medium': () => import('@shikijs/themes/gruvbox-light-medium'),
  'solarized-dark': () => import('@shikijs/themes/solarized-dark'),
  'solarized-light': () => import('@shikijs/themes/solarized-light'),
  'rose-pine': () => import('@shikijs/themes/rose-pine'),
  monokai: () => import('@shikijs/themes/monokai'),
  'ayu-dark': () => import('@shikijs/themes/ayu-dark'),
  'kanagawa-wave': () => import('@shikijs/themes/kanagawa-wave'),
  'everforest-dark': () => import('@shikijs/themes/everforest-dark')
}

let highlighter: Promise<HighlighterCore> | null = null

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [MATRIX_CODE_THEME],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true })
  })
  return highlighter
}

async function highlight(request: HighlightRequest): Promise<HighlightResponse> {
  const core = await getHighlighter()
  if (!core.getLoadedLanguages().includes(request.language)) {
    const language = await LANGUAGE_LOADERS[request.language]()
    await core.loadLanguage(language.default as never)
  }
  if (!core.getLoadedThemes().includes(request.theme)) {
    const load = THEME_LOADERS[request.theme]
    if (!load) throw new Error(`Unknown code theme: ${request.theme}`)
    const theme = await load()
    await core.loadTheme(theme.default as never)
  }
  const result = core.codeToTokens(request.code, {
    lang: request.language,
    theme: request.theme
  })
  return {
    id: request.id,
    background: result.bg,
    foreground: result.fg,
    lines: result.tokens.map((line) =>
      line.map(({ content, color, fontStyle }) => ({ content, color, fontStyle }))
    )
  }
}

self.onmessage = ({ data }: MessageEvent<HighlightRequest>) => {
  highlight(data).then(
    (response) => self.postMessage(response),
    (error: unknown) => {
      console.warn('Highlighting failed:', error)
      self.postMessage({ id: data.id, lines: null } satisfies HighlightResponse)
    }
  )
}
