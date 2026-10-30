/** Languages the highlighter can load. Anything else renders as plain text. */
export const LANGUAGES = [
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'diff',
  'dockerfile',
  'go',
  'html',
  'java',
  'javascript',
  'json',
  'jsx',
  'kotlin',
  'markdown',
  'php',
  'python',
  'ruby',
  'rust',
  'sql',
  'swift',
  'toml',
  'tsx',
  'typescript',
  'xml',
  'yaml'
] as const

export type Language = (typeof LANGUAGES)[number]

const ALIASES: Record<string, Language> = {
  'c++': 'cpp',
  'c#': 'csharp',
  cc: 'cpp',
  cs: 'csharp',
  docker: 'dockerfile',
  golang: 'go',
  h: 'c',
  hpp: 'cpp',
  htm: 'html',
  js: 'javascript',
  kt: 'kotlin',
  md: 'markdown',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  svg: 'xml',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  yml: 'yaml',
  zsh: 'bash'
}

/** Maps a Markdown fence label or file extension to a language, or null for plain text. */
export function resolveLanguage(name: string | undefined): Language | null {
  const key = name?.trim().toLowerCase()
  if (!key) return null
  if ((LANGUAGES as readonly string[]).includes(key)) return key as Language
  return ALIASES[key] ?? null
}

export function languageFromPath(path: string | undefined): Language | null {
  if (!path) return null
  const name = path.split('/').at(-1)?.toLowerCase() ?? ''
  if (name === 'dockerfile') return 'dockerfile'
  return resolveLanguage(name.includes('.') ? name.split('.').at(-1) : undefined)
}
