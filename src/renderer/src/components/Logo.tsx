import type { ReactNode } from 'react'

/** The Gramatrix mark: three falling streams of code. */
export function LogoMark({ size = 20 }: { size?: number }): ReactNode {
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="4" height="11" rx="2" />
      <rect x="8" y="7" width="4" height="11" rx="2" />
      <rect x="14" y="2" width="4" height="7" rx="2" />
      <rect x="14" y="12" width="4" height="4" rx="2" />
    </svg>
  )
}
