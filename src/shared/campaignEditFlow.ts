/** UI-only orchestration. Refresh is driven by the existing page reader/events, never a timer here. */
export type CampaignSaveStatus = 'tạm dừng' | 'chờ xử lý'
export interface EditableCampaign { id: number; status: string; editReady?: boolean }
export type CampaignEditDialog = { kind: 'closed' | 'checking' | 'confirm' | 'waiting' | 'error' | 'save-status'; campaignId?: number; error?: string }

export class CampaignEditFlow<T extends EditableCampaign> {
  private state: CampaignEditDialog = { kind: 'closed' }
  private listeners = new Set<() => void>()
  private operation?: { id: number; controller: AbortController; resolve: (value: T | null) => void; dispose: () => void; reading: boolean; queued: boolean; pausing: boolean }
  private saveChoice?: { resolve: (value: CampaignSaveStatus | null) => void; dispose: () => void }

  constructor(private readonly read: (id: number, signal: AbortSignal) => Promise<T | null>, private readonly pause: (id: number) => Promise<unknown>) {}
  getSnapshot = (): CampaignEditDialog => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(state: CampaignEditDialog): void { this.state = state; this.listeners.forEach(listener => listener()) }
  cancel = (): void => {
    const operation = this.operation
    const choice = this.saveChoice
    this.operation = undefined
    this.saveChoice = undefined
    operation?.controller.abort()
    operation?.dispose()
    choice?.dispose()
    this.publish({ kind: 'closed' })
    operation?.resolve(null)
    choice?.resolve(null)
  }
  prepare = (id: number, signal?: AbortSignal): Promise<T | null> => {
    if (this.operation || this.saveChoice || signal?.aborted) return Promise.resolve(null)
    return new Promise(resolve => {
      const onAbort = () => this.cancel()
      signal?.addEventListener('abort', onAbort, { once: true })
      this.operation = { id, resolve, controller: new AbortController(), dispose: () => signal?.removeEventListener('abort', onAbort), reading: false, queued: false, pausing: false }
      this.publish({ kind: 'checking', campaignId: id })
      void this.check(true)
    })
  }
  private async check(initial = false): Promise<void> {
    const operation = this.operation
    if (!operation || operation.pausing) return
    if (operation.reading) { operation.queued = true; return }
    operation.reading = true
    try {
      const campaign = await this.read(operation.id, operation.controller.signal)
      if (this.operation !== operation) return
      if (!campaign) throw new Error('Không tìm thấy chiến dịch.')
      // `read` must return a fresh API/IPC snapshot, never optimistic UI state.
      // Follow the existing pause status contract; runtime claims are not an edit lock.
      if (campaign.status === 'tạm dừng') {
        this.operation = undefined
        operation.dispose()
        this.publish({ kind: 'closed' })
        operation.resolve(campaign)
      } else if (!['chờ xử lý', 'đang chạy', 'tạm dừng'].includes(campaign.status)) {
        throw new Error('Chiến dịch đã đổi trạng thái và không còn có thể chỉnh sửa.')
      } else {
        this.publish({ kind: initial && campaign.status !== 'tạm dừng' ? 'confirm' : 'waiting', campaignId: operation.id })
      }
    } catch (error) {
      if (this.operation === operation) this.publish({ kind: 'error', campaignId: operation.id, error: error instanceof Error ? error.message : 'Không thể kiểm tra chiến dịch.' })
    } finally {
      operation.reading = false
      if (this.operation === operation && operation.queued && this.state.kind === 'waiting') {
        operation.queued = false
        void this.check()
      }
    }
  }
  refresh = (): void => { if (this.state.kind === 'waiting') void this.check() }
  retry = (): void => {
    if (!this.operation || this.state.kind !== 'error') return
    this.publish({ kind: 'checking', campaignId: this.operation.id })
    void this.check(true)
  }
  confirmPause = async (): Promise<void> => {
    const operation = this.operation
    if (!operation || this.state.kind !== 'confirm') return
    operation.pausing = true
    this.publish({ kind: 'waiting', campaignId: operation.id })
    try {
      await this.pause(operation.id)
      if (this.operation !== operation) return
      operation.pausing = false
      await this.check()
    } catch (error) {
      if (this.operation === operation) this.publish({ kind: 'error', campaignId: operation.id, error: error instanceof Error ? error.message : 'Không thể tạm dừng chiến dịch.' })
    } finally { operation.pausing = false }
  }
  chooseSaveStatus = (signal?: AbortSignal): Promise<CampaignSaveStatus | null> => {
    if (this.operation || this.saveChoice || signal?.aborted) return Promise.resolve(null)
    return new Promise(resolve => {
      const onAbort = () => this.cancel()
      signal?.addEventListener('abort', onAbort, { once: true })
      this.saveChoice = { resolve, dispose: () => signal?.removeEventListener('abort', onAbort) }
      this.publish({ kind: 'save-status' })
    })
  }
  selectSaveStatus = (status: CampaignSaveStatus): void => {
    const choice = this.saveChoice
    if (!choice) return
    this.saveChoice = undefined
    choice.dispose()
    this.publish({ kind: 'closed' })
    choice.resolve(status)
  }
}

/** Never restart completed/running campaigns after an ambiguous resume response. */
export async function resumeSavedCampaigns<T extends EditableCampaign>(
  ids: number[], read: (id: number) => Promise<T | null>, resume: (id: number) => Promise<unknown>, signal: AbortSignal
): Promise<void> {
  for (const id of ids) {
    if (signal.aborted) throw new Error('Phiên sửa chiến dịch đã đóng.')
    const current = await read(id)
    if (signal.aborted) throw new Error('Phiên sửa chiến dịch đã đóng.')
    if (!current) throw new Error('Không tìm thấy chiến dịch đã lưu.')
    if (current.status === 'tạm dừng') {
      await resume(id)
    } else if (!['chờ xử lý', 'đang chạy', 'hoàn thành'].includes(current.status)) {
      throw new Error('Trạng thái chiến dịch đã thay đổi. Vui lòng kiểm tra lại.')
    }
  }
}
