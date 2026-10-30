import type { ReactNode } from 'react'
import { useApp } from '../state/app-context'
import { Banner } from './ui'

export function SecretWarning(): ReactNode {
  const { info } = useApp()
  if (info.secretBackend === 'keychain') return null
  return info.secretBackend === 'weak' ? (
    <Banner tone="warning">
      No keychain service was found, so saved keys are not really protected. Install and unlock
      GNOME Keyring or KWallet to protect them.
    </Banner>
  ) : (
    <Banner tone="error">
      Secure storage is not available, so keys cannot be saved. Check that your system keychain is
      running, then restart Gramatrix.
    </Banner>
  )
}
