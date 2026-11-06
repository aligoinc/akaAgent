// Báo cáo hiệu quả trên Desktop: một kênh IPC, kết quả {ok,data} | {ok:false,code,message} như trung tâm thông báo.
import type {
  CampaignEffectivenessDetail, CampaignEffectivenessList, EffectivenessAiSummary, EffectivenessAssets, EffectivenessCustomerPage,
  EffectivenessDataGroups, EffectivenessHours, EffectivenessLifetime, EffectivenessLifetimeWindow, EffectivenessListStage,
  EffectivenessOverview, EffectivenessPlatform
} from './campaignEffectiveness'

export const EFFECTIVENESS_IPC = 'report:effectiveness' as const

export interface EffectivenessIpcQuery {
  startIso: string
  endIso: string
  flatformType?: EffectivenessPlatform
  accountIds?: number[]
}

export type EffectivenessIpcRequest =
  | { kind: 'platforms' }
  | { kind: 'overview'; query: EffectivenessIpcQuery; compare?: boolean }
  | { kind: 'campaigns'; query: EffectivenessIpcQuery }
  | { kind: 'campaign'; query: EffectivenessIpcQuery; campaignId: number }
  | { kind: 'hours'; query: EffectivenessIpcQuery }
  | { kind: 'dataGroups'; query: EffectivenessIpcQuery }
  | { kind: 'customers'; query: EffectivenessIpcQuery; stage: EffectivenessListStage; page?: number; pageSize?: number; campaignId?: number }
  | { kind: 'lifetime'; flatformType?: EffectivenessPlatform; accountIds?: number[]; window?: EffectivenessLifetimeWindow }
  | { kind: 'assets' }
  | { kind: 'aiSummary'; query: EffectivenessIpcQuery }

export interface EffectivenessIpcResponses {
  platforms: EffectivenessPlatform[]
  overview: EffectivenessOverview
  campaigns: CampaignEffectivenessList
  campaign: CampaignEffectivenessDetail
  hours: EffectivenessHours
  dataGroups: EffectivenessDataGroups
  customers: EffectivenessCustomerPage
  lifetime: EffectivenessLifetime
  assets: EffectivenessAssets
  aiSummary: EffectivenessAiSummary
}

export type EffectivenessIpcResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string }
