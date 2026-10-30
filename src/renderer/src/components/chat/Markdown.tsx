import { isValidElement, memo, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { invoke } from '../../state/hooks'
import { CodeView } from '../code/CodeView'
import { CopyButton } from '../ui'

function CodeBlock({ children }: { children: ReactNode }): ReactNode {
  const code = isValidElement(children)
    ? (children as ReactElement<{ className?: string; children?: ReactNode }>)
    : null
  const language = /language-(\S+)/.exec(code?.props.className ?? '')?.[1]
  const text = String(code?.props.children ?? '').replace(/\n$/, '')
  return (
    <div className="code-block">
      <header>
        <span>{language ?? 'text'}</span>
        <CopyButton text={text} label="Copy code" />
      </header>
      <CodeView code={text} language={language} />
    </div>
  )
}

const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(event) => {
        // The window never navigates. Links open in the system browser.
        event.preventDefault()
        if (href?.startsWith('https://')) void invoke('app.openExternal', { url: href })
      }}
    >
      {children}
    </a>
  ),
  img: ({ alt }) => <span className="muted">{alt ? `[image: ${alt}]` : '[image]'}</span>,
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>
}

/** Renders model output. Raw HTML is dropped, so the output cannot inject markup. */
export const Markdown = memo(function Markdown({ text }: { text: string }): ReactNode {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  )
})
