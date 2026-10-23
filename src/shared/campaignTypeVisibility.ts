export interface CampaignTypeVisibilitySnapshot {
  organizationId: number
  revision: number
  hiddenActionIds: string[]
  updatedAt: string | null
  canEdit: boolean
}
export interface CampaignVisibilityAction {
  id: string
  name: string
  platform: string
  campaignCount: number
}
export interface CampaignTypeVisibilityResult extends CampaignTypeVisibilitySnapshot {
  catalog?: CampaignVisibilityAction[]
}
export interface CampaignVisibilityChange { actionId: string; visible: boolean }
export const CAMPAIGN_TYPE_VISIBILITY_IPC = {
  get: 'settings:campaign-type-visibility:get',
  patch: 'settings:campaign-type-visibility:patch'
} as const

export function validateCampaignVisibilityChanges(value: unknown): CampaignVisibilityChange[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1000) throw new Error('Lựa chọn hiển thị không hợp lệ.')
  const seen = new Set<string>()
  return value.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || Object.keys(row).some(key => key !== 'actionId' && key !== 'visible')
      || typeof row.actionId !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/.test(row.actionId)
      || typeof row.visible !== 'boolean' || seen.has(row.actionId)) throw new Error('Lựa chọn hiển thị không hợp lệ.')
    seen.add(row.actionId)
    return { actionId: row.actionId, visible: row.visible }
  })
}

export function isCampaignTypeVisibilitySnapshot(value: unknown): value is CampaignTypeVisibilitySnapshot {
  if (!value || typeof value !== 'object') return false
  const row = value as CampaignTypeVisibilitySnapshot
  return Number.isSafeInteger(row.organizationId) && row.organizationId > 0
    && Number.isSafeInteger(row.revision) && row.revision >= 0
    && Array.isArray(row.hiddenActionIds) && row.hiddenActionIds.every(id => typeof id === 'string')
    && (row.updatedAt === null || typeof row.updatedAt === 'string') && typeof row.canEdit === 'boolean'
}

export function isCampaignTypeVisible(actionId: string | undefined, snapshot: CampaignTypeVisibilitySnapshot | null): boolean {
  return !actionId || !snapshot?.hiddenActionIds.includes(actionId)
}

/** Presentation-only snapshot. Never use this to decide runtime eligibility. */
export function createCampaignVisibilitySession() {
  let scope = ''
  let snapshot: CampaignTypeVisibilitySnapshot | null = null
  let epoch = 0
  let flight: Promise<CampaignTypeVisibilitySnapshot> | null = null
  let controller: AbortController | null = null
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach(listener => listener())
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    reset(nextScope = '') {
      controller?.abort(); controller = null
      scope = nextScope; snapshot = null; flight = null; epoch++; emit()
    },
    bind(nextScope: string) { if (scope !== nextScope) this.reset(nextScope) },
    accept(next: CampaignTypeVisibilitySnapshot, expectedScope: string) {
      if (scope !== expectedScope || !isCampaignTypeVisibilitySnapshot(next)) return false
      if (snapshot && (snapshot.organizationId !== next.organizationId || snapshot.revision > next.revision)) return false
      const normalized = { organizationId: next.organizationId, revision: next.revision,
        hiddenActionIds: [...next.hiddenActionIds], updatedAt: next.updatedAt, canEdit: next.canEdit }
      if (snapshot && JSON.stringify(snapshot) === JSON.stringify(normalized)) return true
      snapshot = normalized
      emit()
      return true
    },
    load(expectedScope: string, read: (signal: AbortSignal) => Promise<CampaignTypeVisibilitySnapshot>) {
      if (scope !== expectedScope) this.reset(expectedScope)
      if (flight) return flight
      const requestEpoch = epoch
      const request = new AbortController()
      controller = request
      const pending = Promise.resolve().then(() => { request.signal.throwIfAborted(); return read(request.signal) }).then(next => {
        if (epoch !== requestEpoch || scope !== expectedScope) throw new Error('Phiên đăng nhập đã thay đổi.')
        if (!isCampaignTypeVisibilitySnapshot(next)) throw new Error('Cấu hình hiển thị không hợp lệ.')
        this.accept(next, expectedScope)
        return next
      }).finally(() => { if (flight === pending) flight = null })
      flight = pending
      return pending
    }
  }
}
