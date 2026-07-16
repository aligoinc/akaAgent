import { useEffect, useState } from 'react'
import type { ZaloServerOperationStateSnapshot } from '../../../shared/zaloServerProtocol'

/**
 * Renderer-only view of operations owned by akaAgent Zalo Server.
 * Local Zalo sessions never subscribe to this channel.
 */
export function useZaloServerOperationState(enabled: boolean): ZaloServerOperationStateSnapshot | null {
  const [snapshot, setSnapshot] = useState<ZaloServerOperationStateSnapshot | null>(null)

  useEffect(() => {
    if (!enabled) {
      setSnapshot(null)
      return
    }

    let disposed = false
    let receivedUpdateCount = 0
    const acceptUpdate = (value: ZaloServerOperationStateSnapshot) => {
      if (disposed) return
      receivedUpdateCount += 1
      setSnapshot(value)
    }
    const unsubscribe = window.electronAPI?.onZaloServerOperationStateUpdated?.(acceptUpdate)
    const updatesBeforeRead = receivedUpdateCount
    void window.electronAPI?.getZaloServerOperationState?.()
      .then(value => {
        if (!disposed && receivedUpdateCount === updatesBeforeRead) setSnapshot(value)
      })
      .catch(() => {})

    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [enabled])

  return snapshot
}
