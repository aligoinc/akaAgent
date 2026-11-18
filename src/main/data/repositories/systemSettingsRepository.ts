import { SystemSetting } from '../../../shared/types'
import { SLEEP_GUARD_SETTING_KEY } from '../../services/systemSleepGuard'
import { requireCurrentUser } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

const client = () => getSupabaseClient()

export const STARTUP_UPDATE_PROMPT_MAX_VERSION_KEY = 'desktop.updates.startup_prompt_max_version'

// Public startup policy: a fixed non-secret key, readable before auth bootstrap.
// Keep missing/disabled rows distinct from an explicit SQL NULL (all versions).
export async function getStartupUpdatePromptMaxVersion(): Promise<string | null | undefined> {
  const { data, error } = await client()
    .rpc('aka_agent_desktop_startup_policy')
    .abortSignal(AbortSignal.timeout(5_000))

  if (error) throw new Error('Không thể tải cấu hình thông báo cập nhật.')
  return data ? data.value as string | null : undefined
}

function mapSystemSettingFromDB(row: Record<string, unknown>): SystemSetting {
  return {
    id: row.id as number,
    key: row.key as string,
    value: (row.value as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    isSecret: (row.is_secret as boolean) ?? false,
    isActive: (row.is_active as boolean) ?? true,
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined
  }
}

export async function listActiveSystemSettingsByKeys(keys: string[]): Promise<Map<string, SystemSetting>> {
  requireCurrentUser()
  const uniqueKeys = Array.from(new Set(keys.map(key => key.trim()).filter(Boolean)))
  if (uniqueKeys.length === 0) return new Map()

  const { data, error } = await client()
    .from('auto_system_settings')
    .select('*')
    .in('key', uniqueKeys)
    .eq('is_active', true)

  if (error) throw new Error(`Failed to list system settings: ${error.message}`)
  return new Map((data || []).map(row => {
    const setting = mapSystemSettingFromDB(row)
    return [setting.key, setting]
  }))
}

/**
 * Công tắc bộ giữ khi máy ngủ (`desktop.sleep_guard`, docs/DESKTOP_SLEEP_GUARD.md). Thiếu dòng = null (dùng mặc định);
 * lỗi đọc = undefined để bên gọi giữ giá trị đang dùng.
 */
export async function readDesktopSleepGuardSetting(): Promise<string | null | undefined> {
  try {
    const { data, error } = await client().from('auto_system_settings').select('key,value')
      .eq('key', SLEEP_GUARD_SETTING_KEY).eq('is_active', true).eq('is_secret', false).limit(1)
      .abortSignal(AbortSignal.timeout(5_000))
    if (error) return undefined
    const row = (data || [])[0] as { value?: string | null } | undefined
    return row ? row.value ?? null : null
  } catch {
    return undefined
  }
}

export function getSettingValue(settings: Map<string, SystemSetting>, key: string): string {
  return String(settings.get(key)?.value || '').trim()
}
