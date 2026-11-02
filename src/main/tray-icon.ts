// Draws the Gramatrix mark for the system tray: the brackets, prompt and cursor of the app icon
// in one color, without the dark tile. Menu bars and panels expect single color icons.
//
// The shapes sit on a 16 unit grid with whole unit edges. Menu bars show icons at 16 pixels, or
// 32 on high density screens, so every straight edge lands exactly on a pixel and stays sharp.

type Point = readonly [number, number]

const GRID = 16

// [left, top, right, bottom] for the brackets and the cursor. The brackets are thinner than the
// prompt, as in the app icon, which also leaves room between the shapes at 16 pixels.
const RECTANGLES: readonly (readonly [number, number, number, number])[] = [
  [2, 2, 3, 14],
  [2, 2, 5, 3],
  [2, 13, 5, 14],
  [13, 2, 14, 14],
  [11, 2, 14, 3],
  [11, 13, 14, 14],
  [9, 10, 12, 12]
]
// The two strokes of the prompt, as [start, end] pairs.
const PROMPT: readonly (readonly [Point, Point])[] = [
  [
    [5.5, 5],
    [8, 7.5]
  ],
  [
    [8, 7.5],
    [5.5, 10]
  ]
]
const STROKE_WIDTH = 2

// Each pixel is sampled on a grid, so the diagonal gets partial transparency instead of steps.
const SAMPLES_PER_AXIS = 4

function distanceToSegment([x, y]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax
  const dy = by - ay
  const along = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - (ax + along * dx), y - (ay + along * dy))
}

function insideMark(point: Point): boolean {
  const [x, y] = point
  if (
    RECTANGLES.some(
      ([left, top, right, bottom]) => x >= left && x <= right && y >= top && y <= bottom
    )
  ) {
    return true
  }
  return PROMPT.some(([start, end]) => distanceToSegment(point, start, end) <= STROKE_WIDTH / 2)
}

function coverage(column: number, row: number, size: number): number {
  let hits = 0
  for (let sampleRow = 0; sampleRow < SAMPLES_PER_AXIS; sampleRow++) {
    for (let sampleColumn = 0; sampleColumn < SAMPLES_PER_AXIS; sampleColumn++) {
      const x = ((column + (sampleColumn + 0.5) / SAMPLES_PER_AXIS) / size) * GRID
      const y = ((row + (sampleRow + 0.5) / SAMPLES_PER_AXIS) / size) * GRID
      if (insideMark([x, y])) hits++
    }
  }
  return hits / SAMPLES_PER_AXIS ** 2
}

/**
 * Returns the mark as a square bitmap for `nativeImage.createFromBitmap`: 4 bytes per pixel in
 * blue, green, red, alpha order with premultiplied alpha. `gray` sets the color, 0 for black and
 * 255 for white.
 */
export function trayIconBitmap(size: number, gray: number): Buffer {
  const pixels = Buffer.alloc(size * size * 4)
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const alpha = coverage(column, row, size)
      const channel = Math.round(gray * alpha)
      pixels.set([channel, channel, channel, Math.round(255 * alpha)], (row * size + column) * 4)
    }
  }
  return pixels
}
