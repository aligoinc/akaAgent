import type { CampaignConfig } from './types'

export const CAMPAIGN_DRAFT_VERSION = 1
/** Business state only. New form fields are captured without a DB column migration. */
export interface CampaignDraftPayload {
  version: number
  values: Record<string, unknown>
  baseCampaign?: Partial<CampaignConfig>
  cloneSourceCampaignId?: number
}

export interface CampaignDraftSummary {
  id: string
  name: string
  actionId: string
  accountIds: number[]
  schedule: string
  updatedAt: string
  revision: number
}

export interface CampaignDraft extends CampaignDraftSummary {
  payload: CampaignDraftPayload
  isDelete: boolean
  deletionReason: 'user_deleted' | 'converted' | null
  campaignIds: number[]
}

export interface SaveCampaignDraftRequest {
  id: string
  revision: number
  payload: CampaignDraftPayload
}

export interface CampaignDraftPage {
  items: CampaignDraftSummary[]
  total: number
}

/** Metadata only; campaigns have already been created by the normal save flow. */
export interface CompleteCampaignDraftRequest {
  id: string
  revision: number
  campaignIds: number[]
}

export function isDraftRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Merge missing nested defaults; arrays and explicit false/0/empty/null are preserved. */
export function restoreCampaignDraftValue<T>(defaults: T, saved: unknown): T {
  if (saved === undefined) return defaults
  if (!isDraftRecord(defaults) || !isDraftRecord(saved)) return saved as T
  const result: Record<string, unknown> = { ...defaults }
  for (const [key, value] of Object.entries(saved)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    result[key] = restoreCampaignDraftValue(result[key], value)
  }
  return result as T
}

export function validateCampaignDraftPayload(payload: CampaignDraftPayload): void {
  if (!payload || payload.version !== CAMPAIGN_DRAFT_VERSION || !isDraftRecord(payload.values)) {
    throw new Error('Phiên bản bản nháp chưa được hỗ trợ. Vui lòng cập nhật ứng dụng.')
  }
  const form = payload.values.formData
  if (!isDraftRecord(form) || typeof form.name !== 'string' || !form.name.trim()
    || typeof form.actionId !== 'string' || !form.actionId.trim()
    || !Array.isArray(form.accountIds) || form.accountIds.length === 0
    || form.accountIds.some(id => !Number.isSafeInteger(id) || Number(id) <= 0)) {
    throw new Error('Vui lòng nhập Tên, Hành động và Tài khoản để lưu nháp.')
  }
  if (typeof form.schedule !== 'string' || !form.schedule.trim() || !Number.isFinite(Date.parse(form.schedule))) {
    throw new Error('Vui lòng chọn lịch gửi hợp lệ để lưu nháp.')
  }
}

export const CAMPAIGN_DRAFT_IPC = {
  list: 'campaign-drafts:list',
  get: 'campaign-drafts:get',
  save: 'campaign-drafts:save',
  delete: 'campaign-drafts:delete',
  complete: 'campaign-drafts:complete'
} as const
