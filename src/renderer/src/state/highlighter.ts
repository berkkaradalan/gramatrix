import { useEffect, useRef, useState } from 'react'
import { resolveLanguage, type Language } from '../lib/languages'
import { themeById } from '../lib/themes'
import type {
  HighlightRequest,
  HighlightResponse,
  HighlightToken
} from '../workers/highlight-protocol'
import { useApp } from './app-context'

/** Larger blocks stay plain, because a huge colored block costs more than it gives. */
const MAX_HIGHLIGHT_CHARS = 200_000
/** While text is arriving, highlight at most this often. */
const HIGHLIGHT_INTERVAL_MS = 120
const CACHE_SIZE = 100

export interface Highlighted {
  /** The source the tokens were made from. */
  code: string
  lines: HighlightToken[][]
  background: string | undefined
  foreground: string | undefined
}

type Waiting = (response: HighlightResponse) => void

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, Waiting>()
const cache = new Map<string, Highlighted>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/highlight.worker.ts', import.meta.url), {
      type: 'module'
    })
    worker.onmessage = ({ data }: MessageEvent<HighlightResponse>) => {
      waiting.get(data.id)?.(data)
      waiting.delete(data.id)
    }
  }
  return worker
}

function remember(key: string, value: Highlighted): void {
  cache.set(key, value)
  const oldest = cache.keys().next().value
  if (cache.size > CACHE_SIZE && oldest !== undefined) cache.delete(oldest)
}

function requestHighlight(
  code: string,
  language: Language,
  theme: string
): Promise<Highlighted | null> {
  const key = `${theme}\n${language}\n${code}`
  const cached = cache.get(key)
  if (cached) return Promise.resolve(cached)
  return new Promise((resolve) => {
    const request: HighlightRequest = { id: nextId++, code, language, theme }
    waiting.set(request.id, ({ lines, background, foreground }) => {
      if (!lines) return resolve(null)
      const value = { code, lines, background, foreground }
      remember(key, value)
      resolve(value)
    })
    getWorker().postMessage(request)
  })
}

export interface CodeTheme {
  name: string
  /** True when the block should keep the app surface instead of the theme background. */
  matchesApp: boolean
}

export function useCodeTheme(): CodeTheme {
  const { settings } = useApp()
  const { theme } = settings.code
  const name = themeById(theme === 'auto' ? settings.theme : theme).shikiTheme
  return { name, matchesApp: theme === 'auto' }
}

/**
 * Highlights code off the main thread. The previous result is kept until a new one arrives, and
 * lines are matched by their text, so streaming only ever repaints the line being written.
 */
export function useHighlight(
  code: string,
  language: string | undefined,
  theme: string
): Highlighted | null {
  const resolved = resolveLanguage(language)
  const [result, setResult] = useState<Highlighted | null>(null)
  const inFlight = useRef(false)
  const queued = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!resolved || code.length > MAX_HIGHLIGHT_CHARS) {
      setResult(null)
      return
    }
    let stale = false
    const run = (): void => {
      inFlight.current = true
      void requestHighlight(code, resolved, theme).then((value) => {
        inFlight.current = false
        if (!stale) setResult(value)
        const next = queued.current
        queued.current = null
        next?.()
      })
    }
    // Only the newest text matters, so requests made while one is running replace each other.
    const timer = setTimeout(
      () => {
        if (inFlight.current) queued.current = run
        else run()
      },
      result ? HIGHLIGHT_INTERVAL_MS : 0
    )
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [code, resolved, theme])

  return result
}
