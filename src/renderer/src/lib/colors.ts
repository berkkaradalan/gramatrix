export interface Rgb {
  r: number
  g: number
  b: number
}

export function parseHex(hex: string): Rgb {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? [...value].map((digit) => digit + digit).join('') : value
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16)
  }
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value)
}

export function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number): string => Math.round(value).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** Blends `amount` of `other` into `base`, where 1 gives `other`. */
export function mix(base: string, other: string, amount: number): string {
  const from = parseHex(base)
  const to = parseHex(other)
  return toHex({
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount
  })
}

export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex)
  return `rgb(${r} ${g} ${b} / ${Math.round(alpha * 100)}%)`
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex)
  const linear = [r, g, b].map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0)
}

/** WCAG contrast ratio, from 1 to 21. */
export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first)
  const b = relativeLuminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Picks whichever of black or white reads better on a color. */
export function readableOn(background: string): string {
  return contrastRatio(background, '#000000') >= contrastRatio(background, '#ffffff')
    ? '#000000'
    : '#ffffff'
}
