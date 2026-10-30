import type { ReactNode } from 'react'

const LOGOS = import.meta.glob<string>('../assets/providers/*.svg', {
  eager: true,
  query: '?url',
  import: 'default'
})

function logoUrl(name: string): string | undefined {
  return LOGOS[`../assets/providers/${name}.svg`]
}

/** Renders a logo as a mask, so it takes the current text color and follows the theme. */
export function ProviderLogo({ logo, size = 16 }: { logo: string; size?: number }): ReactNode {
  const url = logoUrl(logo)
  const style = { width: size, height: size }
  if (!url) {
    return (
      <span className="provider-logo-fallback" style={style} aria-hidden="true">
        {logo.charAt(0).toUpperCase()}
      </span>
    )
  }
  return (
    <span
      className="provider-logo"
      style={{ ...style, maskImage: `url("${url}")` }}
      aria-hidden="true"
    />
  )
}
