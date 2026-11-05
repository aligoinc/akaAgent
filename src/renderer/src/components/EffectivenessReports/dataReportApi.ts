import type { DataReportIpcRequest, DataReportIpcResponses } from '../../../../shared/dataReportIpc'
import { EffectivenessError } from './effectivenessApi'

/**
 * One data report read over IPC. IPC cannot be cancelled, so an aborted caller simply ignores the late result
 * (the main process keeps its own deadline and cache).
 */
export async function dataReportRequest<R extends DataReportIpcRequest>(request: R, signal?: AbortSignal):
  Promise<DataReportIpcResponses[R['kind']]> {
  signal?.throwIfAborted()
  if (!window.electronAPI?.dataReport) throw new EffectivenessError('report_failed', 'Không thể tải báo cáo dữ liệu.')
  const result = await window.electronAPI.dataReport(request)
  signal?.throwIfAborted()
  if (!result.ok) throw new EffectivenessError(result.code, result.message)
  return result.data as DataReportIpcResponses[R['kind']]
}
