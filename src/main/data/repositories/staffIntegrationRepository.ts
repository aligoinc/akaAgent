import { AkaBizIntegrationInfo, AkaBizIntegrationKind, AkaBizIntegrations } from '../../../shared/types'
import { requireCurrentUser } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

const client = () => getSupabaseClient()

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
  const { data, error } = await client()
    .from('org_staff')
    .select('akabiz_integrations')
    .eq('id', staffId)
    .maybeSingle()

  if (error) throw new Error(`Không thể tải tích hợp akaBiz: ${error.message}`)
  return normalizeIntegrations(data?.akabiz_integrations ?? EMPTY_INTEGRATIONS)
}

export async function saveAkaBizIntegration(
  kind: AkaBizIntegrationKind,
  staff: AkaBizStaffInput
): Promise<AkaBizIntegrations> {
  const user = requireCurrentUser()
  const current = await getAkaBizIntegrationsForStaff(user.staffId)
  const now = new Date().toISOString()
  const nextIntegration: AkaBizIntegrationInfo = {
    id: staff.staffId,
    staffId: staff.staffId,
    username: staff.username.trim(),
    name: staff.name ?? null,
    installPath: staff.installPath ?? null,
    dbPath: staff.dbPath ?? null,
    integratedAt: now
  }
  const next: AkaBizIntegrations = {
    ...current,
    [kind]: nextIntegration
  }

  const { data, error } = await client()
    .from('org_staff')
    .update({
      akabiz_integrations: next,
      updated_at: now
    })
    .eq('id', user.staffId)
    .select('akabiz_integrations')
    .maybeSingle()

  if (error) throw new Error(`Không thể lưu tích hợp akaBiz: ${error.message}`)
  return normalizeIntegrations(data?.akabiz_integrations ?? next)
}

export interface AkaBizStaffInput {
  staffId: number
  username: string
  name?: string | null
  installPath?: string | null
  dbPath?: string | null
}
