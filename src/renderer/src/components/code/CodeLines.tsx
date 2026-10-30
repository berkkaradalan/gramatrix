import { memo, type CSSProperties, type ReactNode } from 'react'
import type { HighlightToken } from '../../workers/highlight-protocol'

const ITALIC = 1
const BOLD = 2
const UNDERLINE = 4

function tokenStyle({ color, fontStyle = 0 }: HighlightToken): CSSProperties {
  const style: CSSProperties = { color }
  if (fontStyle & ITALIC) style.fontStyle = 'italic'
  if (fontStyle & BOLD) style.fontWeight = 600
  if (fontStyle & UNDERLINE) style.textDecoration = 'underline'
  return style
}

/** One line of code. It only repaints when its own text or tokens change. */
export const CodeLine = memo(function CodeLine({
  text,
  tokens
}: {
  text: string
  tokens: HighlightToken[] | undefined
}): ReactNode {
  // Tokens from an older pass are ignored unless they still spell this exact line.
  const usable = tokens && tokens.map(({ content }) => content).join('') === text
  if (!usable) return text
  return tokens.map((token, index) => (
    <span key={index} style={tokenStyle(token)}>
      {token.content}
    </span>
  ))
})
