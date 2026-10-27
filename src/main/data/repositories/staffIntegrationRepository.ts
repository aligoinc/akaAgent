import { AkaBizIntegrationInfo, AkaBizIntegrationKind, AkaBizIntegrations } from '../../../shared/types'
import { requireCurrentUser } from '../currentUser'
import { callCurrentStaffClient } from './staffClientRepository'
import { getSupabaseClient, isTrustedServerSupabaseConfigured } from '../supabaseClient'


const EMPTY_INTEGRATIONS: AkaBizIntegrations = {}

function normalizeIntegration(value: any): AkaBizIntegrationInfo | null {
  if (!value || typeof value !== 'object') return null
  const staffId = Number(value.staffId ?? value.id)
  if (!Number.isFinite(staffId) || staffId <= 0) return null
  const username = typeof value.username === 'string' ? value.username.trim() : ''
  if (!username) return null
  return {
    staffId,
    id: staffId,
    username,
    name: value.name === null || value.name === undefined ? null : String(value.name),
    installPath: value.installPath === null || value.installPath === undefined ? null : String(value.installPath),
    dbPath: value.dbPath === null || value.dbPath === undefined ? null : String(value.dbPath),
    integratedAt: typeof value.integratedAt === 'string' ? value.integratedAt : new Date().toISOString()
  }
}

function normalizeIntegrations(value: unknown): AkaBizIntegrations {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    sms: normalizeIntegration(raw.sms),
    zaloWeb: normalizeIntegration(raw.zaloWeb),
    akaBizDesktop: normalizeIntegration(raw.akaBizDesktop)
  }
}

export async function getAkaBizIntegrations(): Promise<AkaBizIntegrations> {
  const user = requireCurrentUser()
  return getAkaBizIntegrationsForStaff(user.staffId)
}

export async function getAkaBizIntegrationsForStaff(staffId: number): Promise<AkaBizIntegrations> {
  if (requireCurrentUser().staffId !== staffId) throw new Error('Không có quyền đọc tích hợp của nhân viên khác.')
  if (isTrustedServerSupabaseConfigured()) {
    const user = requireCurrentUser()
    const { data, error } = await getSupabaseClient().from('org_staff').select('akabiz_integrations')
      .eq('id', staffId).eq('organization_id', user.organizationId).eq('is_active', true)
      .abortSignal(AbortSignal.timeout(5000)).maybeSingle()
    if (error || !data) throw new Error('Không thể tải tích hợp akaBiz.')
    return normalizeIntegrations(data.akabiz_integrations)
  }
  const staff = await callCurrentStaffClient('read')
  return normalizeIntegrations(staff.akabiz_integrations ?? EMPTY_INTEGRATIONS)
}

export async function saveAkaBizIntegration(
  kind: AkaBizIntegrationKind,
  staff: AkaBizStaffInput
): Promise<AkaBizIntegrations> {
  const profile = await callCurrentStaffClient('save_integration', { kind, integration: {
    staffId: staff.staffId, username: staff.username.trim(), name: staff.name ?? null,
    installPath: staff.installPath ?? null, dbPath: staff.dbPath ?? null
  } })
  return normalizeIntegrations(profile.akabiz_integrations)
}

export interface AkaBizStaffInput {
  staffId: number
  username: string
  name?: string | null
  installPath?: string | null
  dbPath?: string | null
}
