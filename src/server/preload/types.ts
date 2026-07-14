import type {
  ZaloServerClearLogsResult,
  ZaloServerRuntimeEvent,
  ZaloServerSnapshot
} from '../../shared/zaloServerProtocol'

export interface ZaloServerAdminBridge {
  getSnapshot(): Promise<ZaloServerSnapshot>
  clearLogs(): Promise<ZaloServerClearLogsResult>
  onRuntimeEvent(listener: (event: ZaloServerRuntimeEvent) => void): () => void
  onSnapshotUpdated(listener: (snapshot?: ZaloServerSnapshot) => void): () => void
}
