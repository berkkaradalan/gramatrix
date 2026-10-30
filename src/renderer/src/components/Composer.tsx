import { ArrowUp, Square } from 'lucide-react'
import { forwardRef, type ReactNode } from 'react'
import { IconButton } from './ui'

/** The message box used by Home and the chat screen. Controls go in `children`. */
export const Composer = forwardRef<
  HTMLTextAreaElement,
  {
    value: string
    onChange(value: string): void
    onSubmit(): void
    placeholder: string
    large?: boolean
    autoFocus?: boolean
    running?: boolean
    onStop?(): void
    canSend: boolean
    children: ReactNode
  }
>(function Composer(
  { value, onChange, onSubmit, placeholder, large, autoFocus, running, onStop, canSend, children },
  ref
) {
  return (
    <form
      className={large ? 'composer composer-large' : 'composer'}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <textarea
        ref={ref}
        className="composer-input"
        aria-label="Message"
        placeholder={placeholder}
        rows={1}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            onSubmit()
          }
        }}
      />
      <div className="composer-bar">
        {children}
        <span className="spacer" />
        {running ? (
          <IconButton
            className="send-button send-stop"
            icon={Square}
            label="Stop"
            onClick={onStop}
          />
        ) : (
          <IconButton
            className="send-button"
            icon={ArrowUp}
            label="Send"
            type="submit"
            disabled={!canSend}
          />
        )}
      </div>
    </form>
  )
})
