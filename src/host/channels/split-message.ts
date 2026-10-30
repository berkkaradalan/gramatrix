/** Splits text into pieces of at most `limit`, preferring line and word boundaries. */
export function splitMessage(text: string, limit: number): string[] {
  const pieces: string[] = []
  let rest = text.trim()
  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    const lineBreak = window.lastIndexOf('\n')
    const space = window.lastIndexOf(' ')
    // A boundary near the start would produce a tiny piece, so cut hard instead.
    const boundary = Math.max(lineBreak, space)
    const cut = boundary > limit / 2 ? boundary : limit
    pieces.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).trimStart()
  }
  if (rest) pieces.push(rest)
  return pieces
}
