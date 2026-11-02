import { describe, expect, it } from 'vitest'
import { trayIconBitmap } from './tray-icon'

const alphaAt = (pixels: Buffer, size: number, x: number, y: number): number =>
  pixels.readUInt8((y * size + x) * 4 + 3)

describe('trayIconBitmap', () => {
  it('has four bytes for every pixel', () => {
    expect(trayIconBitmap(16, 255)).toHaveLength(16 * 16 * 4)
    expect(trayIconBitmap(32, 0)).toHaveLength(32 * 32 * 4)
  })

  it('leaves the corners and the middle of the mark transparent', () => {
    const pixels = trayIconBitmap(32, 255)

    expect(alphaAt(pixels, 32, 0, 0)).toBe(0)
    expect(alphaAt(pixels, 32, 31, 31)).toBe(0)
    expect(alphaAt(pixels, 32, 22, 10)).toBe(0)
  })

  it('draws the brackets fully opaque', () => {
    const pixels = trayIconBitmap(32, 255)

    expect(alphaAt(pixels, 32, 5, 16)).toBe(255)
    expect(alphaAt(pixels, 32, 27, 16)).toBe(255)
  })

  it('uses one color with premultiplied alpha', () => {
    const white = trayIconBitmap(32, 255)
    const black = trayIconBitmap(32, 0)

    for (let offset = 0; offset < white.length; offset += 4) {
      const alpha = white.readUInt8(offset + 3)
      expect(white.subarray(offset, offset + 3)).toEqual(Buffer.from([alpha, alpha, alpha]))
      expect(black.subarray(offset, offset + 3)).toEqual(Buffer.from([0, 0, 0]))
      expect(black.readUInt8(offset + 3)).toBe(alpha)
    }
  })

  it('softens the edges of the diagonal prompt', () => {
    const alphas = [...trayIconBitmap(32, 255)].filter((_, index) => index % 4 === 3)

    expect(alphas.some((alpha) => alpha > 0 && alpha < 255)).toBe(true)
  })
})
