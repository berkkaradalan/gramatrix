import type { ReactNode } from 'react'

/** The Gramatrix mark: a terminal prompt inside matrix brackets. */
export function LogoMark({ size = 20 }: { size?: number }): ReactNode {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect
        x="1"
        y="1"
        width="98"
        height="98"
        rx="21"
        fill="#000"
        stroke="#00ff41"
        strokeOpacity=".35"
        strokeWidth="2"
      />
      <g fill="none" stroke="#00ff41" strokeWidth="8">
        <path d="M27 24H18V76H27" />
        <path d="M73 24H82V76H73" />
        <path d="M35 39L47 50L35 61" strokeLinecap="square" />
      </g>
      <rect x="52" y="56" width="15" height="8" fill="#e6ffec" />
    </svg>
  )
}
