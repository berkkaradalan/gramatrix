// A heading that "decodes" like a terminal: every letter starts as a random glyph and settles on the
// real one, left to right. The timing lives here, apart from React, so it can be tested.

/** Glyphs shown before a letter settles. ASCII only, like the rest of the code base. */
export const DECODE_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=<>/'

/** How long before the first letter settles, so the whole line is noise for a moment. */
export const DECODE_LEAD_MS = 180

/** Time between two letters settling. */
export const DECODE_STEP_MS = 28

export interface DecodedCharacter {
  character: string
  settled: boolean
}

/** How long decoding `text` takes in total. */
export function decodeDuration(text: string): number {
  return DECODE_LEAD_MS + text.length * DECODE_STEP_MS
}

/**
 * The heading `elapsedMs` after decoding started. Spaces stay spaces, so the shape of the line is
 * readable from the first frame. `random` returns a number from 0 up to 1, like Math.random.
 */
export function decodeFrame(
  text: string,
  elapsedMs: number,
  random: () => number = Math.random
): DecodedCharacter[] {
  return [...text].map((character, index) => {
    const settled = character === ' ' || elapsedMs >= DECODE_LEAD_MS + (index + 1) * DECODE_STEP_MS
    if (settled) return { character, settled }
    const glyph = DECODE_GLYPHS[Math.floor(random() * DECODE_GLYPHS.length)] ?? '#'
    return { character: glyph, settled }
  })
}
