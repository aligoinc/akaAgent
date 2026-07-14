import type { ZaloServerRuntimeEvent, ZaloServerSnapshot } from '../../shared/zaloServerProtocol'

export interface ZaloServerAdminBridge {
  getSnapshot(): Promise<ZaloServerSnapshot>
  onRuntimeEvent(listener: (event: ZaloServerRuntimeEvent) => void): () => void
  onSnapshotUpdated(listener: (snapshot?: ZaloServerSnapshot) => void): () => void
}
