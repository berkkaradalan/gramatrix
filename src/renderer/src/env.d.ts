import type { GramatrixApi } from '@shared/rpc'

declare global {
  interface Window {
    gramatrix: GramatrixApi
  }
}
