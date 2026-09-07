import { useEffect, useState } from 'react'
import type { LoginScreenContent } from '../../../shared/types'

const EMPTY_CONTENT: LoginScreenContent = {
  notification: null,
  links: { website: null, userGuide: null, upgradePayment: null, contactUs: null }
}
const REFRESH_INTERVAL_MS = 60 * 60_000

export function useLoginScreenContent(): LoginScreenContent {
  const [content, setContent] = useState(EMPTY_CONTENT)

  useEffect(() => {
    let disposed = false
    let inFlight = false
    let pending = false

    const refresh = async () => {
      if (disposed) return
      if (!navigator.onLine) { setContent(EMPTY_CONTENT); return }
      if (inFlight) { pending = true; return }
      if (!window.electronAPI?.getLoginScreenContent) return
      inFlight = true
      try {
        const result = await window.electronAPI.getLoginScreenContent()
        if (!disposed) setContent(navigator.onLine ? result : EMPTY_CONTENT)
      } catch {
        if (!disposed) setContent(EMPTY_CONTENT)
      } finally {
        inFlight = false
        if (pending && !disposed) {
          pending = false
          void refresh()
        }
      }
    }
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const handleOffline = () => setContent(EMPTY_CONTENT)

    void refresh()
    const interval = window.setInterval(refreshVisible, REFRESH_INTERVAL_MS)
    window.addEventListener('focus', refreshVisible)
    window.addEventListener('online', refreshVisible)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      disposed = true
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshVisible)
      window.removeEventListener('online', refreshVisible)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [])

  return content
}
