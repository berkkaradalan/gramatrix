// Draws the hero background: Matrix rain above a rolling grid, using ASCII characters only.
// It renders from a prebuilt glyph atlas, because calling fillText for thousands of cells per
// frame is too slow, and it stops whenever nobody can see it.

const GLYPHS = ' .:-+=*01<>/\\{}[]()#%$&;?!'
const FLOOR_GLYPHS = 3
const DENSE_GLYPHS = '#%$&0'
const SHADES = ['#04260f', '#073b19', '#0b5a26', '#118a3c', '#27c95f', '#c4ffd8']
const CELL_WIDTH = 8
const CELL_HEIGHT = 15
const FRAME_MS = 1000 / 30
const HORIZON = 0.66

interface Drop {
  head: number
  speed: number
  length: number
}

function buildAtlas(ratio: number): HTMLCanvasElement {
  const atlas = document.createElement('canvas')
  atlas.width = GLYPHS.length * CELL_WIDTH * ratio
  atlas.height = SHADES.length * CELL_HEIGHT * ratio
  const context = atlas.getContext('2d')
  if (!context) return atlas
  context.scale(ratio, ratio)
  context.font = "12px 'JetBrains Mono Variable', ui-monospace, monospace"
  context.textBaseline = 'top'
  SHADES.forEach((shade, row) => {
    context.fillStyle = shade
    for (let index = 0; index < GLYPHS.length; index += 1) {
      context.fillText(GLYPHS.charAt(index), index * CELL_WIDTH, row * CELL_HEIGHT + 1)
    }
  })
  return atlas
}

function newDrop(rows: number, scatter: boolean): Drop {
  return {
    head: scatter ? Math.random() * rows : -Math.random() * rows * 0.6,
    speed: 0.12 + Math.random() * 0.34,
    length: 5 + Math.floor(Math.random() * 13)
  }
}

/** Picks a stable character for a cell, so the rain reads as code instead of noise. */
function codeGlyph(column: number, row: number): number {
  const hash = Math.abs(Math.sin(column * 12.9898 + row * 78.233) * 43758.5453)
  return FLOOR_GLYPHS + Math.floor((hash % 1) * (GLYPHS.length - FLOOR_GLYPHS))
}

/** A heavy character for a cell, so large shapes stay readable. */
function denseGlyph(column: number, row: number): number {
  const hash = Math.abs(Math.sin(column * 7.13 + row * 3.71) * 9631.77)
  return GLYPHS.indexOf(DENSE_GLYPHS.charAt(Math.floor((hash % 1) * DENSE_GLYPHS.length)))
}

/** Brightness of the floor at a cell. Thin lines run along and across it and roll over time. */
function gridLevel(x: number, y: number, time: number): number {
  const depth = (y - HORIZON) / (1 - HORIZON)
  // The lines bunch up near the horizon, so the floor fades in below it.
  if (depth <= 0.1) return 0
  const distance = 1 / depth
  const worldX = x * distance * 1.4 + 0.5
  const swell = Math.sin(worldX * 1.1 + time * 0.7) * 0.14
  const worldZ = distance * 1.3 + time * 0.45 + swell
  const across = Math.abs((((worldX % 1) + 1) % 1) - 0.5)
  const along = Math.abs((((worldZ % 1) + 1) % 1) - 0.5)
  const edge = 0.5 - 0.035 / Math.max(depth, 0.18)
  if (Math.max(across, along) < edge) return 0
  return Math.min(0.62, 0.1 + depth * 0.6)
}

export function startAsciiField(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d')
  if (!context) return
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const pointer = { x: -1, y: -1 }
  let atlas = buildAtlas(ratio)
  let columns = 0
  let rows = 0
  let drops: Drop[] = []
  let visible = true
  let last = 0

  const resize = (): void => {
    const { width, height } = canvas.getBoundingClientRect()
    canvas.width = Math.floor(width * ratio)
    canvas.height = Math.floor(height * ratio)
    columns = Math.ceil(width / CELL_WIDTH)
    rows = Math.ceil(height / CELL_HEIGHT)
    drops = Array.from({ length: columns }, () => newDrop(rows, true))
  }

  const stamp = (column: number, row: number, level: number, glyph: number): void => {
    const shade = Math.min(SHADES.length - 1, Math.floor(level * SHADES.length))
    context.drawImage(
      atlas,
      glyph * CELL_WIDTH * ratio,
      shade * CELL_HEIGHT * ratio,
      CELL_WIDTH * ratio,
      CELL_HEIGHT * ratio,
      column * CELL_WIDTH * ratio,
      row * CELL_HEIGHT * ratio,
      CELL_WIDTH * ratio,
      CELL_HEIGHT * ratio
    )
  }

  const draw = (time: number): void => {
    context.clearRect(0, 0, canvas.width, canvas.height)
    const seconds = time / 1000
    const horizonRow = Math.floor(rows * HORIZON)

    for (let column = 0; column < columns; column += 1) {
      const drop = drops[column]
      if (!drop) continue
      drop.head += drop.speed
      if (drop.head - drop.length > horizonRow) Object.assign(drop, newDrop(rows, false))
      for (let offset = 0; offset < drop.length; offset += 1) {
        const row = Math.floor(drop.head) - offset
        if (row < 0 || row >= horizonRow) continue
        const fade = 1 - row / horizonRow
        const level = offset === 0 ? 0.92 : (1 - offset / drop.length) * 0.55
        stamp(column, row, level * (0.35 + fade * 0.65), codeGlyph(column, row))
      }
    }

    for (let row = horizonRow; row < rows; row += 1) {
      const y = row / rows
      for (let column = 0; column < columns; column += 1) {
        const x = (column / columns) * 2 - 1
        let level = gridLevel(x, y, seconds)
        if (pointer.x >= 0) {
          const distance = Math.hypot(column - pointer.x, (row - pointer.y) * 2)
          if (distance < 26) level += (1 - distance / 26) * 0.4
        }
        if (level > 0.03)
          stamp(column, row, Math.min(0.99, level), level > 0.4 ? 3 : level > 0.2 ? 2 : 1)
      }
    }
  }

  const loop = (time: number): void => {
    if (!visible || document.hidden) return
    requestAnimationFrame(loop)
    if (time - last < FRAME_MS) return
    last = time
    draw(time)
  }

  const start = (): void => {
    if (!reducedMotion) requestAnimationFrame(loop)
  }

  resize()
  draw(0)
  new ResizeObserver(() => {
    resize()
    if (reducedMotion) draw(0)
  }).observe(canvas)
  new IntersectionObserver(([entry]) => {
    const wasVisible = visible
    visible = entry?.isIntersecting ?? false
    if (visible && !wasVisible) start()
  }).observe(canvas)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) start()
  })
  canvas.parentElement?.addEventListener('pointermove', (event) => {
    const bounds = canvas.getBoundingClientRect()
    pointer.x = (event.clientX - bounds.left) / CELL_WIDTH
    pointer.y = (event.clientY - bounds.top) / CELL_HEIGHT
  })
  canvas.parentElement?.addEventListener('pointerleave', () => {
    pointer.x = -1
  })
  // The atlas needs the bundled font, which may finish loading after the first frame.
  void document.fonts.ready.then(() => {
    atlas = buildAtlas(ratio)
    if (reducedMotion) draw(0)
  })
  start()
}

/** Draws a large word out of characters, with a slow wave of light moving through it. */
export function startAsciiWordmark(canvas: HTMLCanvasElement, word: string): void {
  const context = canvas.getContext('2d')
  if (!context) return
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let atlas = buildAtlas(ratio)
  let cells: { column: number; row: number; glyph: number }[] = []
  let visible = false

  const layout = (): void => {
    const { width } = canvas.getBoundingClientRect()
    const columns = Math.floor(width / CELL_WIDTH)
    const sample = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (!sample || columns === 0) return
    sample.font = "800 100px 'Inter Variable', system-ui, sans-serif"
    const textWidth = sample.measureText(word).width
    // Cells are about twice as tall as they are wide, so the sample is squashed to match.
    const scale = columns / textWidth
    const rows = Math.ceil(100 * scale * (CELL_WIDTH / CELL_HEIGHT) * 1.15)
    sample.canvas.width = columns
    sample.canvas.height = rows
    sample.font = "800 100px 'Inter Variable', system-ui, sans-serif"
    sample.textBaseline = 'alphabetic'
    sample.setTransform(scale, 0, 0, scale * (CELL_WIDTH / CELL_HEIGHT), 0, rows * 0.84)
    sample.fillStyle = '#fff'
    sample.fillText(word, 0, 0)
    const pixels = sample.getImageData(0, 0, columns, rows).data
    cells = []
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        if ((pixels[(row * columns + column) * 4 + 3] ?? 0) > 110) {
          cells.push({ column, row, glyph: denseGlyph(column, row) })
        }
      }
    }
    canvas.style.height = `${rows * CELL_HEIGHT}px`
    canvas.width = Math.floor(width * ratio)
    canvas.height = rows * CELL_HEIGHT * ratio
  }

  const draw = (time: number): void => {
    context.clearRect(0, 0, canvas.width, canvas.height)
    for (const { column, row, glyph } of cells) {
      const wave = Math.sin(column * 0.09 + row * 0.2 - time / 900)
      const shade = wave > 0.8 ? 5 : wave > 0.2 ? 4 : 3
      context.drawImage(
        atlas,
        glyph * CELL_WIDTH * ratio,
        shade * CELL_HEIGHT * ratio,
        CELL_WIDTH * ratio,
        CELL_HEIGHT * ratio,
        column * CELL_WIDTH * ratio,
        row * CELL_HEIGHT * ratio,
        CELL_WIDTH * ratio,
        CELL_HEIGHT * ratio
      )
    }
  }

  let last = 0
  const loop = (time: number): void => {
    if (!visible || document.hidden) return
    requestAnimationFrame(loop)
    if (time - last < 1000 / 15) return
    last = time
    draw(time)
  }

  const refresh = (): void => {
    atlas = buildAtlas(ratio)
    layout()
    draw(0)
  }

  void document.fonts.ready.then(refresh)
  new ResizeObserver(refresh).observe(canvas.parentElement ?? canvas)
  new IntersectionObserver(([entry]) => {
    const wasVisible = visible
    visible = entry?.isIntersecting ?? false
    if (visible && !wasVisible && !reducedMotion) requestAnimationFrame(loop)
  }).observe(canvas)
}
