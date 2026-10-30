import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { useApp } from '../../state/app-context'
import { useCodeTheme, useHighlight } from '../../state/highlighter'
import { CodeLine } from './CodeLines'

/** Past this, per line elements would slow the page more than they help. */
const MAX_RENDERED_LINES = 3000

/** Highlighted code that follows the code settings for numbers, wrapping and ligatures. */
export function CodeView({
  code,
  language,
  numbered = true,
  className
}: {
  code: string
  language: string | undefined
  /** Off for short output, where numbers add nothing. */
  numbered?: boolean
  className?: string
}): ReactNode {
  const { settings } = useApp()
  const codeTheme = useCodeTheme()
  const highlighted = useHighlight(code, language, codeTheme.name)
  const lines = useMemo(() => code.split('\n'), [code])
  const tooLong = lines.length > MAX_RENDERED_LINES

  const style: CSSProperties | undefined =
    highlighted && !codeTheme.matchesApp
      ? { background: highlighted.background, color: highlighted.foreground }
      : undefined
  const classes = [
    'code-view',
    numbered && settings.code.lineNumbers && 'code-numbered',
    settings.code.wrapLines ? 'code-wrap' : 'code-scroll',
    className
  ]

  return (
    <pre className={classes.filter(Boolean).join(' ')} style={style}>
      {tooLong ? (
        <code className="code-line">{code}</code>
      ) : (
        <code>
          {lines.map((line, index) => (
            <span key={index} className="code-line">
              <CodeLine text={line} tokens={highlighted?.lines[index]} />
            </span>
          ))}
        </code>
      )}
    </pre>
  )
}
