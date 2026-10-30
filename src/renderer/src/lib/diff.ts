export interface DiffLine {
  kind: 'same' | 'added' | 'removed'
  text: string
  /** Index in the old text. Absent on added lines. */
  oldIndex?: number
  /** Index in the new text. Absent on removed lines. */
  newIndex?: number
}

/** Above this size the table would be too slow, so the change shows as a full replacement. */
const MAX_DIFF_CELLS = 250_000

/** Line based diff using a longest common subsequence table. */
export function diffLines(before: string, after: string): DiffLine[] {
  const oldLines = before.split('\n')
  const newLines = after.split('\n')
  const rows = oldLines.length
  const columns = newLines.length
  if (rows * columns > MAX_DIFF_CELLS) {
    return [
      ...oldLines.map((text, oldIndex) => ({ kind: 'removed' as const, text, oldIndex })),
      ...newLines.map((text, newIndex) => ({ kind: 'added' as const, text, newIndex }))
    ]
  }

  const width = columns + 1
  const lengths = new Uint32Array((rows + 1) * width)
  for (let row = rows - 1; row >= 0; row--) {
    for (let column = columns - 1; column >= 0; column--) {
      lengths[row * width + column] =
        oldLines[row] === newLines[column]
          ? (lengths[(row + 1) * width + column + 1] ?? 0) + 1
          : Math.max(
              lengths[(row + 1) * width + column] ?? 0,
              lengths[row * width + column + 1] ?? 0
            )
    }
  }

  const lines: DiffLine[] = []
  let row = 0
  let column = 0
  while (row < rows || column < columns) {
    if (row < rows && column < columns && oldLines[row] === newLines[column]) {
      lines.push({ kind: 'same', text: oldLines[row] ?? '', oldIndex: row, newIndex: column })
      row++
      column++
    } else if (
      row < rows &&
      (column === columns ||
        (lengths[(row + 1) * width + column] ?? 0) >= (lengths[row * width + column + 1] ?? 0))
    ) {
      // Removed lines come first, the way people expect to read a diff.
      lines.push({ kind: 'removed', text: oldLines[row] ?? '', oldIndex: row })
      row++
    } else {
      lines.push({ kind: 'added', text: newLines[column] ?? '', newIndex: column })
      column++
    }
  }
  return lines
}
