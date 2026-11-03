import { useEffect, useState, type ReactNode } from 'react'
import { decodeDuration, decodeFrame, type DecodedCharacter } from '../lib/decode-text'
import { useReducedMotion } from '../state/motion'

/** New glyphs at most this often, so the noise reads as flicker rather than a blur. */
const GLYPH_INTERVAL_MS = 45

function settledFrame(text: string): DecodedCharacter[] {
  return [...text].map((character) => ({ character, settled: true }))
}

/**
 * A heading that decodes into its text and ends on a blinking cursor. It plays each time the text
 * changes. Screen readers get the text itself, and reduced motion shows it right away.
 */
export function DecodingHeading({ text }: { text: string }): ReactNode {
  const reduced = useReducedMotion()
  const [frame, setFrame] = useState(() => settledFrame(text))

  useEffect(() => {
    if (reduced) {
      setFrame(settledFrame(text))
      return
    }
    const started = performance.now()
    const duration = decodeDuration(text)
    let lastGlyphs = -Infinity
    let request = 0
    const draw = (now: number): void => {
      const elapsed = now - started
      if (elapsed >= duration) {
        setFrame(settledFrame(text))
        return
      }
      if (now - lastGlyphs >= GLYPH_INTERVAL_MS) {
        lastGlyphs = now
        setFrame(decodeFrame(text, elapsed))
      }
      request = requestAnimationFrame(draw)
    }
    request = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(request)
  }, [text, reduced])

  return (
    <h1 className="decoding-heading" aria-label={text}>
      <span aria-hidden>
        {frame.map(({ character, settled }, index) => (
          <span key={index} className={settled ? undefined : 'decoding-glyph'}>
            {character}
          </span>
        ))}
      </span>
      <span className="decoding-cursor" aria-hidden />
    </h1>
  )
}
