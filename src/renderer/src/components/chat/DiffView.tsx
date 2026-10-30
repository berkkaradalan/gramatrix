import { useMemo, type ReactNode } from 'react'
import { diffLines } from '../../lib/diff'
import { useCodeTheme, useHighlight } from '../../state/highlighter'
import { CodeLine } from '../code/CodeLines'

const MARKERS = { same: ' ', added: '+', removed: '-' }

export function DiffView({
  before,
  after,
  language
}: {
  before: string
  after: string
  language?: string | undefined
}): ReactNode {
  const lines = useMemo(() => diffLines(before, after), [before, after])
  const { name } = useCodeTheme()
  const oldTokens = useHighlight(before, language, name)
  const newTokens = useHighlight(after, language, name)

  return (
    <pre className="diff code-view code-wrap">
      {lines.map((line, index) => (
        <span key={index} className={`diff-line diff-${line.kind}`}>
          <span className="diff-marker">{MARKERS[line.kind]}</span>
          <CodeLine
            text={line.text}
            tokens={
              line.newIndex === undefined
                ? oldTokens?.lines[line.oldIndex ?? 0]
                : newTokens?.lines[line.newIndex]
            }
          />
        </span>
      ))}
    </pre>
  )
}
