import type { EffectivenessIpcRequest, EffectivenessIpcResponses } from '../../../../shared/effectivenessIpc'

/** A failed report read with the stable code from the main process (never technical details). */
export class EffectivenessError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'EffectivenessError'
  }
}

/**
 * One effectiveness read over IPC. IPC cannot be cancelled, so an aborted caller simply ignores the late
 * result (the main process keeps its own deadline and short cache).
 */
export async function effectivenessRequest<R extends EffectivenessIpcRequest>(request: R, signal?: AbortSignal):
  Promise<EffectivenessIpcResponses[R['kind']]> {
  signal?.throwIfAborted()
  if (!window.electronAPI?.effectivenessReport) throw new EffectivenessError('report_failed', 'Không thể tải báo cáo hiệu quả.')
  const result = await window.electronAPI.effectivenessReport(request)
  signal?.throwIfAborted()
  if (!result.ok) throw new EffectivenessError(result.code, result.message)
  return result.data as EffectivenessIpcResponses[R['kind']]
}

/** Desktop screens a report button can open (handled by App). */
export type EffectivenessNavigation =
  | { kind: 'campaigns' }
  | { kind: 'campaign'; campaignId: number }
  | { kind: 'dataScan' }
  | { kind: 'dataGroups' }
  | { kind: 'contentTemplates' }
