// Decodes text in place, like the heading on Home in the app: every letter starts as a random
// glyph and settles on the real one, left to right. The real letters keep their place, hidden,
// while the glyph is drawn over them, so no line changes width or wraps differently.
//
// The page HTML holds the plain text, so search engines and visitors without JavaScript read it as
// usual. An inline script in the head hides the elements until this runs, to avoid a flash of the
// plain text before the noise. See index.astro.

// The page font is proportional, so a glyph wider than the letter under it would overlap its
// neighbors. Each letter therefore draws from glyphs of about its own width.
const NARROW_LETTERS = "iIjlt1fr.,:;!|'"
const WIDE_LETTERS = 'mwMW'
const GLYPHS = {
  narrow: 'il1!|:;.,',
  wide: 'mwMW',
  lower: 'abcdeghknopqsuvxyz0123456789',
  upper: 'ABCDEFGHJKLNOPRSTUVXYZ0123456789#$%&',
  other: '?/*+=<>'
}

/** New glyphs at most this often, so the noise reads as flicker rather than a blur. */
const GLYPH_INTERVAL_MS = 45

/** Set on the root element by the inline script until decoding starts. */
export const PENDING_CLASS = 'decode-pending'

interface Letter {
  span: HTMLSpanElement
  settlesAt: number
}

function glyphsFor(letter: string): string {
  if (NARROW_LETTERS.includes(letter)) return GLYPHS.narrow
  if (WIDE_LETTERS.includes(letter)) return GLYPHS.wide
  if (/[a-z0-9]/.test(letter)) return GLYPHS.lower
  if (/[A-Z]/.test(letter)) return GLYPHS.upper
  return GLYPHS.other
}

function randomGlyph(letter: string): string {
  const glyphs = glyphsFor(letter)
  return glyphs[Math.floor(Math.random() * glyphs.length)] ?? letter
}

/**
 * Decodes one element. `delayMs` waits before the first letter settles, `stepMs` is the time
 * between letters. Screen readers get the plain text the whole time.
 */
function decode(element: HTMLElement, delayMs: number, stepMs: number): void {
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
  const visual = document.createElement('span')
  visual.setAttribute('aria-hidden', 'true')
  const letters: Letter[] = []
  ;[...text].forEach((character, index) => {
    if (character === ' ') {
      visual.append(' ')
      return
    }
    const span = document.createElement('span')
    span.className = 'decode-letter is-scrambled'
    span.textContent = character
    span.dataset['glyph'] = randomGlyph(character)
    visual.append(span)
    letters.push({ span, settlesAt: delayMs + (index + 1) * stepMs })
  })
  const label = document.createElement('span')
  label.className = 'sr-only'
  label.textContent = text
  element.replaceChildren(label, visual)

  const started = performance.now()
  let lastGlyphs = started
  const draw = (now: number): void => {
    const elapsed = now - started
    const refresh = now - lastGlyphs >= GLYPH_INTERVAL_MS
    if (refresh) lastGlyphs = now
    let scrambled = 0
    for (const { span, settlesAt } of letters) {
      if (!span.classList.contains('is-scrambled')) continue
      if (elapsed >= settlesAt) {
        span.classList.remove('is-scrambled')
        continue
      }
      scrambled++
      if (refresh) span.dataset['glyph'] = randomGlyph(span.textContent ?? '')
    }
    // The finished element goes back to plain text, as the page HTML had it.
    if (scrambled === 0) element.replaceChildren(text)
    else requestAnimationFrame(draw)
  }
  requestAnimationFrame(draw)
}

/** Decodes every `[data-decode]` element, unless the visitor asks for reduced motion. */
export function startDecoding(): void {
  const root = document.documentElement
  const elements = document.querySelectorAll<HTMLElement>('[data-decode]')
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const element of elements) {
      decode(
        element,
        Number(element.dataset['decodeDelay'] ?? 0),
        Number(element.dataset['decodeStep'] ?? 28)
      )
    }
  }
  root.classList.remove(PENDING_CLASS)
}
