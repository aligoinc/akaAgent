import type { BrowserPreview } from '../../shared/browserPreview'
import type { WebEnrichmentState } from '../../shared/facebookWebEnrichment'
import type { WebEnrichmentPage } from './webEnrichmentBrowser'

/** Stream the actual disposable page through the same browser UI channel as campaigns. */
export function attachWebEnrichmentPreview(
  entry: WebEnrichmentPage,
  state: WebEnrichmentState,
  send: (preview: BrowserPreview) => void
): WebEnrichmentPage {
  let stopped = false
  let capturing = false
  let unsubscribe: (() => void) | undefined
  const emit = (active: boolean, image?: string) => {
    try {
      send({ ...state, context: 'web-enrichment', active, image,
        title: 'Làm giàu lịch sử Web', timestamp: new Date().toISOString() })
    } catch { /* A closed renderer must never hold the account or fail the browsing session. */ }
  }
  const capture = async () => {
    if (stopped || capturing) return
    capturing = true
    try {
      if (!entry.page.isConnected()) return
      const image = await entry.page.screenshot()
      if (!stopped) emit(true, `data:image/png;base64,${image}`)
    } catch { /* Preview is best effort, independent from the workflow. */ }
    finally { capturing = false }
  }
  // Same cadence as campaign previews; one capture in flight, only while this page lives.
  const timer = setInterval(() => void capture(), 2000)
  const stop = () => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    unsubscribe?.()
    emit(false)
  }
  unsubscribe = entry.onClosed?.(stop)
  emit(true)
  void capture()
  return { ...entry, destroy: () => { stop(); entry.destroy() } }
}
