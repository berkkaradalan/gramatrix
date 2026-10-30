import type { Language } from '../lib/languages'

export interface HighlightRequest {
  id: number
  code: string
  language: Language
  /** Name of a Shiki theme. */
  theme: string
}

export interface HighlightToken {
  content: string
  color?: string
  /** Bit flags from Shiki: 1 italic, 2 bold, 4 underline. */
  fontStyle?: number
}

export interface HighlightResponse {
  id: number
  lines: HighlightToken[][] | null
  background?: string
  foreground?: string
}
