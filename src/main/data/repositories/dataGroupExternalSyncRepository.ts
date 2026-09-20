import type { GoogleSheetConfig, GoogleSheetPreview, SaveDataGroupExternalSyncSource, DataGroupExternalSyncPanel, DataGroupExternalSyncSource, GoogleSheetInspection } from '../../../shared/googleSheetSync'
import { googleSheetUrl, readGoogleSheet, mapGoogleSheet, validateSheetConfig } from '../../../shared/googleSheetSync'
import { getCurrentUser, getCurrentUserCredentials, requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

function camelKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelKeys)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), camelKeys(item)]))
  return value
}

function context() {
  const user = requireCurrentUser(), credentials = requireCurrentUserCredentials()
  const check = () => {
    const current = getCurrentUser()
    if (current?.staffId !== user.staffId || current.organizationId !== user.organizationId || getCurrentUserCredentials() !== credentials) throw new Error('Phiên đăng nhập đã thay đổi.')
  }
  const rpc = async <T>(action: string, input: Record<string, unknown>): Promise<T> => {
    check()
    const { data, error } = await getSupabaseClient().rpc('aka_agent_data_group_external_sync', {
      p_staff_id: user.staffId, p_organization_id: user.organizationId,
      p_auth_username: credentials.username, p_auth_password: credentials.password,
      p_action: action, p_data: input
    }).abortSignal(AbortSignal.timeout(action === 'preview' ? 65_000 : 15_000))
    check()
    if (error) {
      const message = error.message || ''
      if (message.includes('sheet_sync_conflict')) throw new Error('Nguồn đã được thay đổi. Hãy tải lại trước khi lưu.')
      if (message.includes('sheet_sync_type')) throw new Error('Loại data hoặc tài khoản của nhóm đã thay đổi. Hãy kết nối và cấu hình lại nguồn.')
      if (message.includes('sheet_sync_config')) throw new Error('Cấu hình nguồn không hợp lệ. Kiểm tra link, cột dữ liệu và lịch đồng bộ.')
      if (message.includes('not_found')) throw new Error('Nhóm hoặc nguồn đồng bộ không còn tồn tại.')
      if (message.includes('sheet_sync_expired')) throw new Error('Ngày dừng đồng bộ đã qua. Hãy sửa ngày dừng trước khi bật nguồn.')
      if (message.includes('sheet_sync_requires_save')) throw new Error('Hãy kiểm tra và lưu lại cấu hình nguồn trước khi bật đồng bộ.')
      throw new Error(error.code === '57014' ? 'Kiểm tra dữ liệu quá thời gian. Vui lòng thử lại.' : 'Không thể hoàn tất thao tác đồng bộ. Hãy kiểm tra phiên đăng nhập hoặc thử lại.')
    }
    return camelKeys(data) as T
  }
  return { rpc, check }
}

export const listDataGroupExternalSync = (groupId: number) => context().rpc<DataGroupExternalSyncPanel>('list', { groupId })

export async function inspectDataGroupSheet(groupId: number, url: string, hasHeader: boolean): Promise<GoogleSheetInspection> {
  const ctx = context()
  await ctx.rpc('check', { groupId })
  const doc = await readGoogleSheet(url, hasHeader)
  ctx.check()
  return { url: doc.url, headers: doc.headers, sample: doc.rows.slice(0, 5), rowCount: doc.rows.length }
}

export async function previewDataGroupSheet(groupId: number, config: GoogleSheetConfig, sourceId?: number): Promise<GoogleSheetPreview> {
  validateSheetConfig(config)
  const ctx = context()
  await ctx.rpc('check', { groupId })
  const mapped = mapGoogleSheet(await readGoogleSheet(config.url, config.hasHeader), config)
  ctx.check()
  const result = await ctx.rpc<{ newCount: number; duplicateCount: number; invalidCount: number }>('preview', { groupId, sourceId: sourceId ?? null, config, rows: mapped.rows })
  return { ...result, rowCount: mapped.rowCount, invalidCount: mapped.invalidCount + result.invalidCount, sample: mapped.rows.slice(0, 10), errors: mapped.errors }
}

export async function saveDataGroupExternalSync(input: SaveDataGroupExternalSyncSource): Promise<DataGroupExternalSyncSource> {
  validateSheetConfig(input.config)
  const ctx = context()
  await ctx.rpc('check', { groupId: input.groupId })
  // Read again at save: a stale preview must not persist a mapping that has moved.
  mapGoogleSheet(await readGoogleSheet(input.config.url, input.config.hasHeader), input.config)
  ctx.check()
  return ctx.rpc('save', { ...input, config: { ...input.config, url: googleSheetUrl(input.config.url).url } })
}

export async function toggleDataGroupExternalSync(groupId: number, id: number, expectedRevision: number, enabled: boolean): Promise<void> {
  await context().rpc('toggle', { groupId, id, expectedRevision, enabled })
}
export async function removeDataGroupExternalSync(groupId: number, id: number, expectedRevision: number): Promise<void> {
  await context().rpc('delete', { groupId, id, expectedRevision })
}
